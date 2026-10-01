import { FIRM_TIMEZONE, firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type {
  PriorityReason,
  WorkItem,
  WorkItemOverride,
} from '@/lib/work/types'

const PRIORITY_RANK: Record<NonNullable<WorkItem['taskPriority']>, number> = {
  high: 0,
  normal: 1,
  low: 2,
}

function timeOrMax(value: string | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

function timeOrMin(value: string | undefined): number {
  if (!value) return Number.MIN_SAFE_INTEGER
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.MIN_SAFE_INTEGER : parsed
}

/** The explicit, stable tie-break order used everywhere the work graph appears. */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  if (a.priorityBand !== b.priorityBand) return a.priorityBand - b.priorityBand

  const hard = timeOrMax(a.hardDueAt) - timeOrMax(b.hardDueAt)
  if (hard !== 0) return hard

  const aWaiting = a.clientWaitingSince ? 0 : 1
  const bWaiting = b.clientWaitingSince ? 0 : 1
  if (aWaiting !== bWaiting) return aWaiting - bWaiting
  if (aWaiting === 0) {
    const waitingAge = timeOrMin(a.clientWaitingSince) - timeOrMin(b.clientWaitingSince)
    if (waitingAge !== 0) return waitingAge
  }

  const appointment = timeOrMax(a.appointmentAt) - timeOrMax(b.appointmentAt)
  if (appointment !== 0) return appointment

  const due = timeOrMax(a.dueAt) - timeOrMax(b.dueAt)
  if (due !== 0) return due

  const priority = PRIORITY_RANK[a.taskPriority ?? 'normal'] - PRIORITY_RANK[b.taskPriority ?? 'normal']
  if (priority !== 0) return priority

  // Older untouched work comes first.
  const stale = timeOrMin(a.staleSince) - timeOrMin(b.staleSince)
  if (stale !== 0) return stale

  if (a.estimateMinutes !== b.estimateMinutes) return a.estimateMinutes - b.estimateMinutes
  return a.workKey.localeCompare(b.workKey)
}

export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort(compareWorkItems)
}

function uniqueReasons(reasons: PriorityReason[]): PriorityReason[] {
  const seen = new Set<string>()
  return reasons.filter(reason => {
    if (seen.has(reason.code)) return false
    seen.add(reason.code)
    return true
  })
}

/** Merge exact stable keys while retaining every source as evidence. */
export function dedupeWorkItems(items: WorkItem[]): WorkItem[] {
  const byKey = new Map<string, WorkItem>()
  for (const item of items) {
    const existing = byKey.get(item.workKey)
    if (!existing) {
      byKey.set(item.workKey, {
        ...item,
        sourceIds: [...new Set(item.sourceIds)],
        evidence: [...item.evidence],
        priorityReasons: uniqueReasons(item.priorityReasons),
      })
      continue
    }

    const winner = compareWorkItems(item, existing) < 0 ? item : existing
    byKey.set(item.workKey, {
      ...winner,
      sourceIds: [...new Set([...existing.sourceIds, ...item.sourceIds])],
      evidence: [...existing.evidence, ...item.evidence].filter((evidence, index, all) =>
        all.findIndex(candidate =>
          candidate.sourceType === evidence.sourceType && candidate.sourceId === evidence.sourceId
        ) === index),
      priorityReasons: uniqueReasons([...winner.priorityReasons, ...existing.priorityReasons, ...item.priorityReasons]),
    })
  }
  return sortWorkItems([...byKey.values()])
}

/** Apply the user's decision after source ranking, without mutating source data. */
export function applyWorkOverrides(
  items: WorkItem[],
  overrides: WorkItemOverride[],
  now: Date = new Date(),
): WorkItem[] {
  const byKey = new Map(overrides.map(override => [override.work_key, override]))
  return sortWorkItems(items.map(item => {
    const override = byKey.get(item.workKey)
    if (!override) return item

    if (override.state === 'snoozed') {
      const wakeAt = override.snoozed_until ? Date.parse(override.snoozed_until) : Number.POSITIVE_INFINITY
      if (wakeAt <= now.getTime()) return item
      return {
        ...item,
        state: 'snoozed' as const,
        priorityBand: 4 as const,
        priorityReasons: [{ code: 'snoozed', label: `Snoozed until ${new Intl.DateTimeFormat('en-US', {
          month: 'short', day: 'numeric', timeZone: FIRM_TIMEZONE,
        }).format(new Date(wakeAt))}` }],
      }
    }

    if (override.state === 'blocked') {
      return {
        ...item,
        state: 'blocked' as const,
        priorityBand: 4 as const,
        priorityReasons: [{ code: 'blocked', label: 'Blocked' }],
      }
    }
    if (override.state === 'waiting') {
      return {
        ...item,
        state: 'waiting' as const,
        priorityBand: 4 as const,
        priorityReasons: [{ code: 'waiting_external', label: 'Waiting on someone else' }],
      }
    }
    return { ...item, state: 'open' as const }
  }))
}

export function isDueBeforeFirmDate(iso: string | null | undefined, dateKey: string): boolean {
  return Boolean(iso && firmDateKey(iso) && (firmDateKey(iso) as string) < dateKey)
}

export function isDueOnFirmDate(iso: string | null | undefined, dateKey = firmTodayKey()): boolean {
  return Boolean(iso && firmDateKey(iso) === dateKey)
}

/** Business days from `fromKey` to `toKey`; same day is zero. */
export function businessDaysBetween(fromKey: string, toKey: string): number {
  const start = new Date(`${fromKey}T12:00:00Z`)
  const end = new Date(`${toKey}T12:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return Number.MAX_SAFE_INTEGER
  const direction = start <= end ? 1 : -1
  let cursor = new Date(start)
  let days = 0
  while ((direction > 0 && cursor < end) || (direction < 0 && cursor > end)) {
    cursor = new Date(cursor.getTime() + direction * 86_400_000)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += direction
  }
  return days
}
