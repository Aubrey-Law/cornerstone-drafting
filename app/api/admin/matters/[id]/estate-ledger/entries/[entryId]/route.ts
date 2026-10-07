import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { deleteEntry } from '@/lib/estateLedger/server'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/matters/[id]/estate-ledger/entries/[entryId]
//
// Entries are corrected by deleting and entering again, so the ledger never
// holds an amount that was silently changed after a sale was measured on it.

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id, entryId } = await params
  if (!isUuid(id) || !isUuid(entryId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const deleted = await deleteEntry(getAdminClient(), id, entryId)
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete' }, { status: 500 })
  }
}
