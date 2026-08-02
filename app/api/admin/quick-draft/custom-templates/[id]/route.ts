import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { archiveCustomTemplate, customTemplateRowId } from '@/lib/documentTemplates/customTemplates'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** Archive (soft-delete) a custom template. The stored file is retained. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const rowId = customTemplateRowId(id) ?? id
  try {
    await archiveCustomTemplate(rowId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Archive failed' }, { status: 500 })
  }
}
