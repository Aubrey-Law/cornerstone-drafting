import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createTemplateBuilderUpload } from '@/lib/templateBuilder/uploads'

export const runtime = 'nodejs'

/** Multipart upload starting a Template Builder session (form field: file). */
export async function POST(req: NextRequest) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'A DOCX file is required.' }, { status: 400 })
    }
    const row = await createTemplateBuilderUpload({
      filename: file.name || 'template.docx',
      buffer: Buffer.from(await file.arrayBuffer()),
      actorId: user.id,
    })
    return NextResponse.json({ uploadId: row.id, filename: row.filename }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed'
    const status = /not a readable DOCX|under 15 MB|migration/.test(message) ? 400 : 500
    if (status === 500) console.error('[template-builder uploads] error', e)
    return NextResponse.json({ error: message }, { status })
  }
}
