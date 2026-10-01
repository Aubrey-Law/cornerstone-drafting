import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  recordCommandCenterUsage,
  type CommandCenterUsageEvent,
} from '@/lib/work/usageServer'

const CLIENT_EVENTS = new Set<CommandCenterUsageEvent>([
  'command_center_opened',
  'legacy_today_opened',
  'work_snoozed',
  'work_blocked',
])

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => null) as { event?: unknown } | null
  if (typeof body?.event !== 'string' || !CLIENT_EVENTS.has(body.event as CommandCenterUsageEvent)) {
    return NextResponse.json({ error: 'Unsupported telemetry event' }, { status: 400 })
  }
  try {
    await recordCommandCenterUsage({ userId: auth.userId, event: body.event as CommandCenterUsageEvent })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('command center client telemetry failed', {
      event: body.event,
      cause: error instanceof Error ? error.message : 'unknown',
    })
    return NextResponse.json({ error: 'Telemetry could not be recorded' }, { status: 500 })
  }
}
