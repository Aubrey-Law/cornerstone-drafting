import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { deriveCalendarAttention } from '@/lib/calendarAttention'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : firmTodayKey()
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const date = validDate(req.nextUrl.searchParams.get('date'))
  const result = await deriveCalendarAttention(date)
  const { data } = await getAdminClient()
    .from('calendar_attention_dismissals')
    .select('item_id')
    .eq('user_id', auth.userId)
    .eq('calendar_date', date)
  const dismissed = new Set((data ?? []).map(row => row.item_id))
  return NextResponse.json({
    items: result.items.filter(item => !dismissed.has(item.id)),
    rail: result.rail,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { itemId?: unknown; date?: unknown }
  const itemId = typeof body.itemId === 'string' ? body.itemId.slice(0, 300) : ''
  const date = validDate(typeof body.date === 'string' ? body.date : null)
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  const { error } = await getAdminClient().from('calendar_attention_dismissals').upsert({
    user_id: auth.userId,
    item_id: itemId,
    calendar_date: date,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
