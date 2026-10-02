import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { updateDailyPlan, type DailyPlanItemStatus, type DailyPlanStatus } from '@/lib/work/plans'
import { recordCommandCenterUsageSafely, type CommandCenterUsageEvent } from '@/lib/work/usageServer'
import { executeDailyPlanCalendarSync } from '@/lib/work/dailyPlanCalendarAction'

// Closing is a reviewed, audited action. It deliberately has a dedicated
// endpoint so a generic status PATCH cannot silently seal a day.
const PLAN_STATUSES: DailyPlanStatus[] = ['draft', 'committed']
const ITEM_STATUSES: DailyPlanItemStatus[] = ['planned', 'started', 'completed', 'skipped']

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid daily plan' }, { status: 400 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const status = PLAN_STATUSES.includes(body?.status as DailyPlanStatus)
    ? body?.status as DailyPlanStatus
    : undefined
  const order = Array.isArray(body?.order)
    ? body.order.filter((value): value is string => typeof value === 'string' && value.length > 2)
    : undefined
  const rawItem = body?.item && typeof body.item === 'object' ? body.item as Record<string, unknown> : null
  const item = rawItem
    && typeof rawItem.workKey === 'string'
    && ITEM_STATUSES.includes(rawItem.status as DailyPlanItemStatus)
    ? { workKey: rawItem.workKey, status: rawItem.status as DailyPlanItemStatus }
    : undefined
  const planningDurationSeconds = typeof body?.planningDurationSeconds === 'number'
    && Number.isFinite(body.planningDurationSeconds)
    ? Math.max(0, Math.min(86_400, Math.round(body.planningDurationSeconds)))
    : null
  const choiceDurationSeconds = typeof body?.choiceDurationSeconds === 'number'
    && Number.isFinite(body.choiceDurationSeconds)
    ? Math.max(0, Math.min(86_400, Math.round(body.choiceDurationSeconds)))
    : null
  if (!status && !order?.length && !item) {
    return NextResponse.json({ error: 'No valid plan change supplied' }, { status: 400 })
  }
  try {
    const plan = await updateDailyPlan({ userId: auth.userId, planId: id, status, order, item })
    const events: Array<{ event: CommandCenterUsageEvent; durationSeconds?: number | null }> = []
    if (status === 'committed') events.push({ event: 'plan_committed', durationSeconds: planningDurationSeconds })
    if (order?.length) events.push({ event: 'plan_replanned' })
    if (item?.status === 'started') events.push({ event: 'work_started', durationSeconds: choiceDurationSeconds })
    if (item?.status === 'completed') events.push({ event: 'work_completed' })
    await Promise.all(events.map(event => recordCommandCenterUsageSafely({ userId: auth.userId, ...event })))
    let calendarSync = null
    let calendarSyncError: string | null = null
    if (status === 'committed' && auth.user) {
      try {
        calendarSync = await executeDailyPlanCalendarSync(plan.id, auth.user)
      } catch (error) {
        // The plan commitment is authoritative even when a connected calendar
        // is temporarily unavailable. Return a recoverable warning instead of
        // pretending the already-persisted plan failed to commit.
        calendarSyncError = error instanceof Error ? error.message : 'Calendar blocks could not be synced'
      }
    }
    return NextResponse.json({ plan, calendarSync, calendarSyncError })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update the daily plan'
    return NextResponse.json({ error: message }, { status: message === 'Daily plan not found' ? 404 : 500 })
  }
}
