import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { LedgerInputError, computeAccount, ledgerCsv, parseAssetInput, parseEntryInput, sortEntries } from '@/lib/estateLedger/model'
import { EstateLedgerUnavailableError, createAsset, createEntry, loadLedger } from '@/lib/estateLedger/server'

export const dynamic = 'force-dynamic'

// GET  /api/admin/matters/[id]/estate-ledger            — inventory, entries and the account
// GET  /api/admin/matters/[id]/estate-ledger?format=csv — the same as a spreadsheet
// POST /api/admin/matters/[id]/estate-ledger            — add an asset ({ type: 'asset' })
//                                                         or an entry ({ type: 'entry' })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const ledger = await loadLedger(getAdminClient(), id)
    if (!ledger) return NextResponse.json({ assets: [], entries: [], account: computeAccount([], []), unavailable: true })
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new NextResponse(ledgerCsv(ledger.assets, ledger.entries), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="estate-ledger-${id.slice(0, 8)}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json({
      assets: ledger.assets,
      entries: sortEntries(ledger.entries),
      account: computeAccount(ledger.assets, ledger.entries),
      unavailable: false,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The ledger is unavailable' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const admin = getAdminClient()
  try {
    if (body.type === 'asset') {
      const asset = await createAsset(admin, id, parseAssetInput(body), auth.userId)
      return NextResponse.json({ asset }, { status: 201 })
    }
    if (body.type === 'entry') {
      const ledger = await loadLedger(admin, id)
      if (!ledger) throw new EstateLedgerUnavailableError()
      const entry = await createEntry(admin, id, parseEntryInput(body, ledger.assets, ledger.entries), auth.userId)
      return NextResponse.json({ entry }, { status: 201 })
    }
    return NextResponse.json({ error: "type must be 'asset' or 'entry'" }, { status: 400 })
  } catch (error) {
    if (error instanceof LedgerInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof EstateLedgerUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save' }, { status: 500 })
  }
}
