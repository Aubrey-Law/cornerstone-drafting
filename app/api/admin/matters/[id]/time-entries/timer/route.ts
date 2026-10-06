import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { discardTimer, startTimer, stopTimer, TimeEntriesUnavailableError } from '@/lib/timeEntries/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function failure(error: unknown, fallback: string) {
  const status = error instanceof TimeEntriesUnavailableError ? 503 : 500
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status })
}

/** Starts the viewer's timer on this matter, stopping and recording one running elsewhere. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: { description?: unknown } = {}
  try { body = await req.json() } catch { /* an empty body starts a timer with no description */ }
  try {
    const description = typeof body.description === 'string' ? body.description : null
    return NextResponse.json(await startTimer(getAdminClient(), { userId: auth.userId, matterId: id, description }))
  } catch (error) {
    return failure(error, 'Could not start the timer')
  }
}

/** Stops the viewer's timer and records the time; `?discard=1` throws it away instead. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    if (new URL(req.url).searchParams.get('discard') === '1') {
      return NextResponse.json({ discarded: await discardTimer(getAdminClient(), auth.userId), entry: null })
    }
    return NextResponse.json({ entry: await stopTimer(getAdminClient(), auth.userId) })
  } catch (error) {
    return failure(error, 'Could not stop the timer')
  }
}
