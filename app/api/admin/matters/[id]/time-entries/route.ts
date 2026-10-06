import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { firmTodayKey } from '@/lib/firmDate'
import { parseTimeEntryInput } from '@/lib/timeEntries/model'
import { insertTimeEntry, listMatterTimeEntries, TimeEntriesUnavailableError } from '@/lib/timeEntries/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await listMatterTimeEntries(id, auth.userId ?? null))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Time entries are unavailable' }, { status: 500 })
  }
}

/** A time entry typed in on the matter page. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  let input
  try {
    input = parseTimeEntryInput({
      matterId: id,
      workDate: typeof body.workDate === 'string' && body.workDate ? body.workDate : firmTodayKey(),
      minutes: body.minutes,
      description: body.description,
      source: 'manual',
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid time entry' }, { status: 400 })
  }
  try {
    const { entry } = await insertTimeEntry(getAdminClient(), input, auth.userId)
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    const status = error instanceof TimeEntriesUnavailableError ? 503 : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record the time' }, { status })
  }
}
