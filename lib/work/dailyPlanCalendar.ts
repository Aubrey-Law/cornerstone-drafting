import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllBusy } from '@/lib/appointments/calendarBusy'
import {
  cancelCalendarEvent,
  createCalendarHold,
  rescheduleCalendarEvent,
} from '@/lib/appointments/googleEvents'
import { getOrCreateInternalHoldType } from '@/lib/appointments/internalHoldType'
import type { StoredDailyPlan, StoredDailyPlanItem } from '@/lib/work/plans'
import type { WorkItem } from '@/lib/work/types'

const DAY_MS = 86_400_000
const SOURCE = 'daily_plan_hold'

interface DailyPlanHoldRow {
  id: string
  start_time: string
  end_time: string
  google_event_id: string | null
  attendee_name: string
  status: string
  raw: unknown
}

export interface DesiredDailyPlanBlock {
  workKey: string
  startAt: string
  endAt: string
  title: string | null
  recordType: StoredDailyPlanItem['record_type']
  recordId: string | null
}

export interface DailyPlanCalendarStatus {
  desiredBlocks: number
  syncedBlocks: number
  pendingBlocks: number
  staleBlocks: number
}

export interface DailyPlanCalendarSyncResult extends DailyPlanCalendarStatus {
  created: number
  moved: number
  unchanged: number
  removed: number
  failures: Array<{ workKey: string; message: string }>
}

function rawObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rawText(value: unknown, key: string): string | null {
  const entry = rawObject(value)[key]
  return typeof entry === 'string' && entry ? entry : null
}

function rawBoolean(value: unknown, key: string): boolean {
  return rawObject(value)[key] === true
}

function sameWindow(row: Pick<DailyPlanHoldRow, 'start_time' | 'end_time'>, block: DesiredDailyPlanBlock) {
  return Date.parse(row.start_time) === Date.parse(block.startAt)
    && Date.parse(row.end_time) === Date.parse(block.endAt)
}

function overlaps(start: number, end: number, busy: { start: number; end: number }) {
  return start < busy.end && end > busy.start
}

/** The exact blocks accepted by Commit. No AI selection occurs here. */
export function desiredDailyPlanBlocks(
  plan: StoredDailyPlan,
  workItems: WorkItem[],
): DesiredDailyPlanBlock[] {
  const workByKey = new Map(workItems.map(item => [item.workKey, item]))
  return plan.items.flatMap(row => {
    if (
      !row.block_start
      || !row.block_end
      || row.lane === 'later'
      || row.status === 'skipped'
    ) return []
    const work = workByKey.get(row.work_key)
    return [{
      workKey: row.work_key,
      startAt: row.block_start,
      endAt: row.block_end,
      title: row.lane === 'communication' ? 'Communication batch' : work?.title ?? null,
      recordType: row.record_type,
      recordId: row.record_id,
    }]
  })
}

function activePlanHolds(rows: DailyPlanHoldRow[], planId: string) {
  return rows.filter(row => row.status === 'scheduled'
    && rawText(row.raw, 'source') === SOURCE
    && rawText(row.raw, 'dailyPlanId') === planId)
}

export function summarizeDailyPlanCalendar(
  plan: StoredDailyPlan,
  desired: DesiredDailyPlanBlock[],
  rows: DailyPlanHoldRow[],
  now = new Date(),
): DailyPlanCalendarStatus {
  const active = activePlanHolds(rows, plan.id)
  const exact = new Map<string, DailyPlanHoldRow>()
  for (const block of desired) {
    const match = active.find(row => rawText(row.raw, 'workKey') === block.workKey && sameWindow(row, block))
    if (match) exact.set(block.workKey, match)
  }
  const syncedBlocks = desired.filter(block => {
    const row = exact.get(block.workKey)
    return Boolean(row?.google_event_id) && !rawBoolean(row?.raw, 'calendarSyncPending')
  }).length
  const desiredKeys = new Set(desired.map(block => block.workKey))
  const staleBlocks = active.filter(row => {
    if (Date.parse(row.end_time) <= now.getTime()) return false
    const workKey = rawText(row.raw, 'workKey')
    const desiredBlock = workKey ? desired.find(block => block.workKey === workKey) : null
    return !workKey || !desiredKeys.has(workKey) || !desiredBlock || !sameWindow(row, desiredBlock)
  }).length
  return {
    desiredBlocks: desired.length,
    syncedBlocks,
    pendingBlocks: Math.max(0, desired.length - syncedBlocks),
    staleBlocks,
  }
}

async function listPlanHolds(admin: SupabaseClient, planId: string): Promise<DailyPlanHoldRow[]> {
  const { data, error } = await admin
    .from('appointments')
    .select('id, start_time, end_time, google_event_id, attendee_name, status, raw')
    .contains('raw', { source: SOURCE, dailyPlanId: planId })
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as DailyPlanHoldRow[]
}

export async function getDailyPlanCalendarStatus(
  admin: SupabaseClient,
  plan: StoredDailyPlan,
  workItems: WorkItem[],
): Promise<DailyPlanCalendarStatus> {
  const [rows] = await Promise.all([listPlanHolds(admin, plan.id)])
  return summarizeDailyPlanCalendar(plan, desiredDailyPlanBlocks(plan, workItems), rows)
}

async function cancelHold(admin: SupabaseClient, row: DailyPlanHoldRow) {
  if (row.google_event_id) await cancelCalendarEvent(row.google_event_id)
  const { error } = await admin.from('appointments').update({
    status: 'cancelled',
    raw: { ...rawObject(row.raw), calendarSyncPending: false, cancelledByPlanSync: true },
  }).eq('id', row.id).eq('status', 'scheduled')
  if (error) throw new Error(error.message)
}

async function syncHoldToGoogle(
  admin: SupabaseClient,
  row: DailyPlanHoldRow,
  block: DesiredDailyPlanBlock,
  title: string,
) {
  let eventId = row.google_event_id
  if (eventId) {
    await rescheduleCalendarEvent(eventId, block.startAt, block.endAt)
  } else {
    const created = await createCalendarHold({
      title,
      startIso: block.startAt,
      endIso: block.endAt,
      matterId: block.recordType === 'matter' ? block.recordId : null,
      showAsBusy: true,
      idempotencyKey: `daily-plan:${row.id}`,
    })
    eventId = created.eventId
  }
  const { error } = await admin.from('appointments').update({
    google_event_id: eventId,
    raw: { ...rawObject(row.raw), calendarSyncPending: false },
  }).eq('id', row.id)
  if (error) throw new Error(error.message)
}

async function createLocalHold(input: {
  admin: SupabaseClient
  appointmentTypeId: string
  plan: StoredDailyPlan
  block: DesiredDailyPlanBlock
  title: string
  actorId: string
  actorEmail: string | null
}): Promise<DailyPlanHoldRow> {
  const attendeeName = `Plan block: ${input.title}`
  const raw = {
    source: SOURCE,
    calendarShowAsBusy: true,
    calendarSyncPending: true,
    suppressDueReminder: true,
    dailyPlanId: input.plan.id,
    dailyPlanDate: input.plan.plan_date,
    dailyPlanGeneratedAt: input.plan.generated_at,
    workKey: input.block.workKey,
  }
  const { data, error } = await input.admin.from('appointments').insert({
    appointment_type_id: input.appointmentTypeId,
    start_time: input.block.startAt,
    end_time: input.block.endAt,
    status: 'scheduled',
    attendee_name: attendeeName,
    attendee_email: input.actorEmail?.toLowerCase() || 'noreply@aubreylegal.com',
    attendee_phone: null,
    notes: 'Reserved from the committed Cornerstone daily plan.',
    linked_lead_id: input.block.recordType === 'lead' ? input.block.recordId : null,
    linked_matter_id: input.block.recordType === 'matter' ? input.block.recordId : null,
    booked_by_user_id: input.actorId,
    source: 'admin',
    raw,
  }).select('id, start_time, end_time, google_event_id, attendee_name, status, raw').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not reserve the plan block')
  return data as unknown as DailyPlanHoldRow
}

/**
 * Reconcile the committed plan with internal calendar holds. The local
 * appointment exclusion constraint is the final race guard; Google writes use
 * deterministic ids so a retry cannot duplicate an event.
 */
export async function syncDailyPlanCalendar(input: {
  admin: SupabaseClient
  plan: StoredDailyPlan
  workItems: WorkItem[]
  actorId: string
  actorEmail: string | null
  now?: Date
}): Promise<DailyPlanCalendarSyncResult> {
  if (input.plan.status !== 'committed') throw new Error('Commit the daily plan before syncing calendar blocks')
  const now = input.now ?? new Date()
  const desired = desiredDailyPlanBlocks(input.plan, input.workItems)
  const initialRows = await listPlanHolds(input.admin, input.plan.id)
  const active = activePlanHolds(initialRows, input.plan.id)
  const desiredByKey = new Map(desired.map(block => [block.workKey, block]))
  const failures: DailyPlanCalendarSyncResult['failures'] = []
  let created = 0
  let moved = 0
  let unchanged = 0
  let removed = 0

  let otherBusy: Array<{ start: number; end: number }> = []
  if (desired.length) {
    const starts = [...desired.map(block => Date.parse(block.startAt)), ...active.map(row => Date.parse(row.start_time))]
    const ends = [...desired.map(block => Date.parse(block.endAt)), ...active.map(row => Date.parse(row.end_time))]
    const busy = await fetchAllBusy(
      new Date(Math.min(...starts) - DAY_MS),
      new Date(Math.max(...ends) + DAY_MS),
    )
    const ownWindows = active.map(row => ({ start: Date.parse(row.start_time), end: Date.parse(row.end_time) }))
    otherBusy = busy.filter(interval => !ownWindows.some(own => own.start === interval.start && own.end === interval.end))
  }

  const blockedKeys = new Set<string>()
  for (const row of active) {
    const workKey = rawText(row.raw, 'workKey') ?? `appointment:${row.id}`
    const block = desiredByKey.get(workKey)
    if (block && sameWindow(row, block)) continue
    // Preserve historical time accounting. Only future stale blocks need to
    // be removed from the active working calendar.
    if (Date.parse(row.end_time) <= now.getTime()) continue
    try {
      await cancelHold(input.admin, row)
      if (block) moved += 1
      else removed += 1
    } catch (error) {
      blockedKeys.add(workKey)
      failures.push({ workKey, message: error instanceof Error ? error.message : 'Could not remove the old block' })
    }
  }

  const acceptedWindows: Array<{ start: number; end: number }> = []
  let appointmentTypeId: string | null = null
  for (const block of desired) {
    const matching = active.find(row => rawText(row.raw, 'workKey') === block.workKey && sameWindow(row, block))
    const title = block.title ?? matching?.attendee_name.replace(/^Plan block:\s*/, '') ?? null
    if (blockedKeys.has(block.workKey)) continue
    if (!title) {
      failures.push({ workKey: block.workKey, message: 'The source record is temporarily unavailable' })
      continue
    }
    const start = Date.parse(block.startAt)
    const end = Date.parse(block.endAt)
    const conflict = otherBusy.some(interval => overlaps(start, end, interval))
      || acceptedWindows.some(interval => overlaps(start, end, interval))
    if (conflict) {
      failures.push({ workKey: block.workKey, message: 'The suggested time now overlaps another calendar commitment' })
      continue
    }
    acceptedWindows.push({ start, end })

    if (matching) {
      if (matching.google_event_id && !rawBoolean(matching.raw, 'calendarSyncPending')) {
        unchanged += 1
        continue
      }
      try {
        await syncHoldToGoogle(input.admin, matching, block, title)
        unchanged += 1
      } catch (error) {
        failures.push({ workKey: block.workKey, message: error instanceof Error ? error.message : 'Calendar sync failed' })
      }
      continue
    }

    try {
      appointmentTypeId ??= await getOrCreateInternalHoldType(input.admin)
      const row = await createLocalHold({
        admin: input.admin,
        appointmentTypeId,
        plan: input.plan,
        block,
        title,
        actorId: input.actorId,
        actorEmail: input.actorEmail,
      })
      created += 1
      try {
        await syncHoldToGoogle(input.admin, row, block, title)
      } catch (error) {
        failures.push({ workKey: block.workKey, message: error instanceof Error ? error.message : 'Calendar sync failed' })
      }
    } catch (error) {
      failures.push({ workKey: block.workKey, message: error instanceof Error ? error.message : 'Could not reserve the plan block' })
    }
  }

  const finalRows = await listPlanHolds(input.admin, input.plan.id)
  return {
    ...summarizeDailyPlanCalendar(input.plan, desired, finalRows, now),
    created,
    moved,
    unchanged,
    removed,
    failures,
  }
}
