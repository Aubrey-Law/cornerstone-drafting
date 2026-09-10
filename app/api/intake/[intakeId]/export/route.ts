import { NextResponse } from 'next/server'
import { Packer } from 'docx'
import { resolveIntakeUploadAccess } from '@/lib/intake/resolveIntakeUploadAccess'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import {
  buildPortalReviewSections,
  type PortalReviewSection,
} from '@/lib/intake/portalReviewSections'
import {
  buildIntakeWordDocument,
  intakeExportFilename,
  type IntakeExportMeta,
  type IntakeExportSection,
} from '@/lib/intake/wordExport'
import { getIntakeTrack } from '@/lib/intakeTrack'

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Params = { params: Promise<{ intakeId: string }> }

function safeHeaderFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'intake-answers.docx'
}

function toExportSections(sections: PortalReviewSection[]): IntakeExportSection[] {
  return sections.map((section) =>
    section.kind === 'fields'
      ? {
          title: section.title,
          rows: section.rows.map(([label, value]) => ({ label, value })),
        }
      : { title: section.title, rows: [], lines: section.entries },
  )
}

/**
 * Download the client's own intake answers as a Word document.
 *
 * This is the portal-side counterpart to the attorney export: it prints what
 * the review screen shows, in the review's own wording, so the download reads
 * as "a copy of what I submitted" rather than as the attorney's form.
 *
 * Authorization is `resolveIntakeUploadAccess`, the same check the portal's
 * document routes use: an invite token must resolve to this exact intake and
 * to a row with no account yet, and a signed-in caller must own the row
 * (`user_id` or `client_user_id`). The id in the path is therefore checked,
 * never trusted — a client cannot read another client's intake by changing it.
 */
export async function GET(req: Request, { params }: Params) {
  const { intakeId } = await params

  const access = await resolveIntakeUploadAccess(req, intakeId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { data, error } = await access.admin
      .from('client_intake')
      .select('*')
      .eq('id', intakeId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Intake not found' }, { status: 404 })

    const hydrated = await hydrateIntakeWithContacts(
      access.admin,
      data as Record<string, unknown>,
      intakeId,
    )

    const clientName = [hydrated.first_name, hydrated.last_name]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ')

    const meta: IntakeExportMeta = {
      clientName,
      // The cover line addresses the client, so it carries the questionnaire
      // they answered rather than the firm's practice-area code.
      practiceArea: getIntakeTrack(hydrated) === 'college_prep'
        ? 'College Preparation Plan'
        : 'Estate Planning',
      intakeTrack: getIntakeTrack(hydrated),
      // Deliberately omitted: the workflow status ("draft", "approved") is
      // internal pipeline vocabulary and means nothing to the client.
      status: null,
      exportedOn: new Date().toISOString().slice(0, 10),
    }

    const sections = toExportSections(buildPortalReviewSections(hydrated))
    const document = buildIntakeWordDocument(sections, {
      ...meta,
      documentTitle: 'Your Intake Answers',
    })
    const buffer = await Packer.toBuffer(document)
    const filename = safeHeaderFilename(
      intakeExportFilename(meta.clientName, meta.exportedOn).replace('Intake-Form', 'My-Intake'),
    )

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': DOCX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to export your answers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
