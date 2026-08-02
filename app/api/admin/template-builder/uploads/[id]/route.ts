import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getTemplateBuilderUpload, loadTemplateBuilderBuffer } from '@/lib/templateBuilder/uploads'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** Download the current working copy so the attorney can inspect it in Word. */
export async function GET(req: NextRequest, { params }: Params) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const row = await getTemplateBuilderUpload(id)
    if (!row) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    const buffer = await loadTemplateBuilderBuffer(row)
    const downloadName = row.revision > 0
      ? row.filename.replace(/\.docx$/i, `-rev${row.revision}.docx`)
      : row.filename
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`,
        'X-Revision': String(row.revision),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Download failed' }, { status: 500 })
  }
}
