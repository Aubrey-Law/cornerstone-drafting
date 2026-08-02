import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  createCustomTemplate,
  customTemplateId,
  listCustomTemplates,
} from '@/lib/documentTemplates/customTemplates'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { templates, migrationRequired } = await listCustomTemplates()
    return NextResponse.json({
      migrationRequired,
      templates: templates.map(row => ({
        id: customTemplateId(row.id),
        rowId: row.id,
        label: row.label,
        outputFilename: row.output_filename,
        variables: row.variables,
        clauses: row.clauses,
        createdAt: row.created_at,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to list custom templates' }, { status: 500 })
  }
}

/** Upload a one-off DOCX template (multipart form: file, label, output_filename?). */
export async function POST(req: NextRequest) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    const label = form?.get('label')
    if (!form || !(file instanceof File) || typeof label !== 'string' || !label.trim()) {
      return NextResponse.json({ error: 'A DOCX file and a label are required.' }, { status: 400 })
    }
    const outputFilename = form.get('output_filename')
    const row = await createCustomTemplate({
      label,
      buffer: Buffer.from(await file.arrayBuffer()),
      actorId: user.id,
      outputFilename: typeof outputFilename === 'string' ? outputFilename : undefined,
    })
    return NextResponse.json({
      id: customTemplateId(row.id),
      rowId: row.id,
      label: row.label,
      outputFilename: row.output_filename,
      variables: row.variables,
      clauses: row.clauses,
    }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed'
    const status = /not a readable DOCX|label is required|under 15 MB|migration/.test(message) ? 400 : 500
    if (status === 500) console.error('[custom-templates route] upload error', e)
    return NextResponse.json({ error: message }, { status })
  }
}
