import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchLedgerPage } from '@/lib/queries/billing'
import { pageRequest } from '@/lib/queries/page'
import { firmTodayKey } from '@/lib/firmDate'
/** Authorized, bounded search for payment allocation; never reads every charge into the browser. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const params = new URL(req.url).searchParams
  let page
  try { page = pageRequest({ page: params.get('page') ?? 1 }); if ((params.get('q')?.length ?? 0) > 200) throw new Error('Search too long') }
  catch { return NextResponse.json({ error: 'Invalid charge search' }, { status: 400 }) }
  try {
    const result = await fetchLedgerPage({ ...page, filter: 'open', search: params.get('q') ?? '', month: firmTodayKey().slice(0,7) })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Open charges unavailable' }, { status: 503 }) }
}
