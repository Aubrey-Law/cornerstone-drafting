import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { buildClientVariables, buildSpouseVariables } from '@/lib/drafting/variables'
import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'
import { projectDraftPayloadToFlatSheet } from '@/lib/drafting/projectDesignSheet'

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
    const resolvedMatterId = await resolveMatterId(matter_id, admin).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!resolvedMatterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    let payload
    try {
      payload = await buildDraftPayload(resolvedMatterId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build draft payload'
      return NextResponse.json({ error: message }, { status: 422 })
    }

    const flatSheet = projectDraftPayloadToFlatSheet(payload)

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

        const isDocTitle  = /^[A-Z][A-Z\s&',()./:!-]{4,99}$/.test(t) && !t.endsWith('.')
        const isArticle   = /^\d+(\.\d+)?\s+[A-Z]/.test(t)
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

    const clientName = payload.client.full_name || resolvedMatterId
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
