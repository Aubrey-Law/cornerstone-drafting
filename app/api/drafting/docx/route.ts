import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { buildClientVariables, buildSpouseVariables, buildFlatSheet } from '@/lib/drafting/variables'
import { resolveMatterId } from '@/lib/buildDraftPayload'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'

const SPOUSE_DOC_TYPES = new Set([
  'pour_over_wills_x2',
  'wills_x2',
  'wills_testamentary_x2',
  'dpoa_x2',
  'hcp_x2',
  'hipaa_x2',
])

function safeHeaderFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'draft.docx'
}

export async function POST(req: NextRequest) {
  try {
    const { err } = await requireAdmin(req)
    if (err) return err

    const { text, matter_id, doc_type, label } = await req.json()

    if (!text || !matter_id) {
      return NextResponse.json({ error: 'text and matter_id required' }, { status: 400 })
    }

    const admin = getAdminClient()
    const resolvedMatterId = await resolveMatterId(matter_id, admin)
    const { data: matter } = await admin
      .from('matters')
      .select('id, client_intake_id')
      .eq('id', resolvedMatterId)
      .maybeSingle()

    if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const [{ data: intake }, { data: designSheet }] = await Promise.all([
      admin.from('client_intake').select('*').eq('id', matter.client_intake_id).maybeSingle(),
      admin
        .from('design_sheets')
        .select('*')
        .eq('matter_id', resolvedMatterId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (!intake || !designSheet) {
      return NextResponse.json({ error: 'Missing intake or design sheet' }, { status: 404 })
    }

    const spouse = await loadSpouseContact(admin, matter.client_intake_id)
    const children = await loadHouseholdChildren(admin, matter.client_intake_id)
    const intakeWithSpouse = {
      ...(intake as Record<string, unknown>),
      spouse_first_name: spouse?.first_name ?? null,
      spouse_middle_name: spouse?.middle_name ?? null,
      spouse_last_name: spouse?.last_name ?? null,
      spouse_suffix: spouse?.suffix ?? null,
      spouse_preferred_pronoun: spouse?.preferred_pronoun ?? null,
      spouse_prior_names: spouse?.prior_names ?? null,
      spouse_date_of_birth: spouse?.date_of_birth ?? null,
      spouse_phone: spouse?.phone ?? null,
      spouse_email: spouse?.email ?? null,
      // Children from contacts (output-identical to the legacy mirror).
      children,
    }

    const flatSheet = buildFlatSheet(intakeWithSpouse, designSheet)

    // For x2 docs generate both client + spouse versions combined in one docx.
    const isX2 = SPOUSE_DOC_TYPES.has(doc_type)

    const clientVars = buildClientVariables(flatSheet)
    const spouseVars = isX2 ? buildSpouseVariables(flatSheet) : null

    function fillPlaceholders(raw: string, vars: Record<string, string>): string {
      let filled = raw
      for (const [placeholder, value] of Object.entries(vars)) {
        filled = filled.split(placeholder).join(value)
      }
      return filled
    }

    const clientFilled = fillPlaceholders(text, clientVars)
    const spouseFilled = isX2 && spouseVars ? fillPlaceholders(text, spouseVars) : null

    // Build docx
    const { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak } = await import('docx')

    function textToChildren(filled: string): InstanceType<typeof Paragraph>[] {
      const lines = filled.split('\n')
      const paragraphs: InstanceType<typeof Paragraph>[] = []

      for (const line of lines) {
        const t = line.trim()
        if (!t) {
          paragraphs.push(new Paragraph({ spacing: { after: 60 } }))
          continue
        }

        // ALL-CAPS heading (e.g. "TRUST NAME", "POWERS OF PERSONAL REPRESENTATIVE")
        const isDocTitle  = /^[A-Z][A-Z\s&',()./:!-]{4,99}$/.test(t) && !t.endsWith('.')
        // Numbered article heading (e.g. "1. TRUST NAME" or "4.1 Appointment")
        const isArticle   = /^\d+(\.\d+)?\s+[A-Z]/.test(t)
        // Indented sub-paragraph (e.g. "(a) ..." or "1. ...")
        const isIndented  = /^\([a-z0-9]\)/.test(t) || /^\d+\.\s+\w/.test(t)

        if (isDocTitle && !isArticle) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: t, bold: true, font: 'Times New Roman', size: 24 })],
            spacing: { before: 360, after: 180 },
            alignment: AlignmentType.CENTER,
          }))
        } else if (isArticle) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: t, bold: true, font: 'Times New Roman', size: 24 })],
            spacing: { before: 240, after: 120 },
          }))
        } else {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: t, font: 'Times New Roman', size: 24 })],
            spacing: { after: 120 },
            alignment: AlignmentType.JUSTIFIED,
            indent: isIndented ? { left: 720 } : undefined,
          }))
        }
      }

      return paragraphs
    }

    const clientParas = textToChildren(clientFilled)

    // For x2 docs, append spouse document after a page break.
    let allChildren: InstanceType<typeof Paragraph>[]
    if (spouseFilled) {
      const pageBreakPara = new Paragraph({
        children: [new PageBreak()],
      })
      allChildren = [...clientParas, pageBreakPara, ...textToChildren(spouseFilled)]
    } else {
      allChildren = clientParas
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        children: allChildren,
      }],
    })

    const bufferResult = await Packer.toBuffer(doc)
    const buffer = new Uint8Array(bufferResult)

    const clientName = (intake.full_name as string | null) ||
      [intake.first_name, intake.last_name].filter(Boolean).join(' ') ||
      resolvedMatterId
    const filename = safeHeaderFilename(`${label ?? doc_type} - ${clientName}.docx`)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[drafting/docx]', message)
    return NextResponse.json({ error: `Failed to build DOCX: ${message}` }, { status: 500 })
  }
}
