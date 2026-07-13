import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { validateDocxStructure } from '@/lib/documentTemplates/docx'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'
import { createDocumentTemplateVersion } from '@/lib/documentTemplates/repository'

type Params = { params: Promise<{ templateId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  const { templateId } = await params
  if (!getDocumentTemplateDefinition(templateId)) {
    return NextResponse.json({ error: 'Unknown document template' }, { status: 404 })
  }
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart upload' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'DOCX file is required' }, { status: 400 })
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return NextResponse.json({ error: 'Only Microsoft Word DOCX templates are accepted' }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const structureError = validateDocxStructure(buffer)
  if (structureError) return NextResponse.json({ error: structureError }, { status: 400 })
  try {
    const version = await createDocumentTemplateVersion({
      templateId,
      filename: file.name,
      buffer,
      actorId: userId!,
    })
    return NextResponse.json({ version }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: message.includes('already been uploaded') ? 409 : 500 })
  }
}

export const runtime = 'nodejs'
