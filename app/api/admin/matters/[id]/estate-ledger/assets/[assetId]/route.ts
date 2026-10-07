import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { LedgerInputError, parseAssetInput } from '@/lib/estateLedger/model'
import { deleteAsset, loadLedger, updateAsset } from '@/lib/estateLedger/server'

export const dynamic = 'force-dynamic'

// PATCH  /api/admin/matters/[id]/estate-ledger/assets/[assetId] — correct an inventory asset
// DELETE /api/admin/matters/[id]/estate-ledger/assets/[assetId] — remove one never sold or distributed

type Params = { params: Promise<{ id: string; assetId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id, assetId } = await params
  if (!isUuid(id) || !isUuid(assetId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  try {
    const admin = getAdminClient()
    const ledger = await loadLedger(admin, id)
    const disposed = ledger?.entries.some(entry => entry.assetId === assetId) ?? false
    const asset = await updateAsset(admin, id, assetId, parseAssetInput(body), disposed)
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ asset, valueLocked: disposed })
  } catch (error) {
    if (error instanceof LedgerInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id, assetId } = await params
  if (!isUuid(id) || !isUuid(assetId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const deleted = await deleteAsset(getAdminClient(), id, assetId)
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    if (error instanceof LedgerInputError) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete' }, { status: 500 })
  }
}
