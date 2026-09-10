import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { requireAdmin } from '@/lib/apiAuth'
import { loadAdminIntakeRow } from '@/lib/intake/loadAdminIntakeRow'
import { mapRawIntakeToFormData } from '@/lib/intake/adminIntakeFormMapping'
import {
  buildIntakeExportSections,
  buildIntakeWordDocument,
  intakeExportFilename,
  type IntakeExportMeta,
} from '@/lib/intake/wordExport'
import { getIntakeTrack } from '@/lib/intakeTrack'
import { practiceAreaLabel } from '@/lib/practiceArea'

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Params = { params: Promise<{ intakeId: string }> }

function safeHeaderFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'intake-form.docx'
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Download one client intake as a Word document.
 *
 * The row is flattened with the same mapper the attorney intake sheet uses, so
 * the export prints exactly the answers the form shows — including which
 * sections the practice area and track put in front of the attorney.
 *
 * `?practiceArea=` lets the caller pass the label it is displaying (the sheet
 * gets it from the lead/matter, which is authoritative); the intake row's own
 * `practice_area` is the fallback.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { intakeId } = await params

  try {
    const row = await loadAdminIntakeRow(intakeId)
    if (!row) {
      return NextResponse.json({ error: 'Intake not found' }, { status: 404 })
    }

    const form = mapRawIntakeToFormData(row)
    const requestedPracticeArea = req.nextUrl.searchParams.get('practiceArea')?.trim()
    const clientName = [form.first_name, form.last_name]
      .map(part => part.trim())
      .filter(Boolean)
      .join(' ')

    const meta: IntakeExportMeta = {
      clientName,
      practiceArea: requestedPracticeArea || practiceAreaLabel(str(row, 'practice_area')),
      intakeTrack: getIntakeTrack(row),
      status: str(row, 'status') || null,
      exportedOn: new Date().toISOString().slice(0, 10),
    }

    const document = buildIntakeWordDocument(buildIntakeExportSections(form, meta), meta)
    const buffer = await Packer.toBuffer(document)
    const filename = safeHeaderFilename(intakeExportFilename(meta.clientName, meta.exportedOn))

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': DOCX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export intake form'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
