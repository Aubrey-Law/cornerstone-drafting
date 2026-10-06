import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { deleteTimeEntry, TimeEntriesUnavailableError } from '@/lib/timeEntries/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id, entryId } = await params
  if (!isUuid(id) || !isUuid(entryId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const deleted = await deleteTimeEntry(getAdminClient(), { matterId: id, entryId })
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    const status = error instanceof TimeEntriesUnavailableError ? 503 : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not remove the entry' }, { status })
  }
}
