import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { STAGE_GROUP_LABELS, STAGE_GROUP_ORDER } from '@/lib/matter/stageGroups'
import { stageInfo, type StageGroup } from '@/types/database'
import { matterLastMilestoneAt, matterQuietDays } from '@/lib/matters/cardFacts'
import type { MatterListRow } from '@/lib/queries/matters'

/**
 * Shapes the matter dashboard. Pure: give it rows, get a snapshot back.
 *
 * The split mirrors `lib/crm/dashboard.ts` — the query module does the IO, this
 * one does the arithmetic — which is what makes the numbers on the page testable
 * without a database.
 */

/** A headline count plus how it moved against the prior month. */
export interface MatterTotal {
  count: number
  newThisMonth: number
  newPriorMonth: number
  deltaPercent: number | null
}

export interface MatterSlice {
  key: string
  label: string
  count: number
  percent: number
}

export interface MatterDashboardSnapshot {
  open: MatterTotal
  /** Matters whose plan was executed, i.e. the work finished. */
  executed: MatterTotal
  awaitingIntake: number
  needsAttention: number
  signingSoon: number
  stages: MatterSlice[]
  practiceAreas: MatterSlice[]
  recent: MatterListRow[]
}

/** Past this many days without a milestone, a matter is worth looking at. */
export const QUIET_MATTER_DAYS = 14
/** Signings inside this window are near enough to prepare for. */
export const SIGNING_SOON_DAYS = 30
const RECENT_MATTER_LIMIT = 8

function monthKeys(today: string): { current: string; prior: string } {
  const [year, month] = today.split('-').map(Number)
  const prior = new Date(Date.UTC(year, month - 2, 1))
  return { current: today.slice(0, 7), prior: prior.toISOString().slice(0, 7) }
}

function percentDelta(current: number, prior: number): number | null {
  // No prior month to compare against is not a 100% rise; it is unknown.
  if (prior === 0) return null
  return Math.round(((current - prior) / prior) * 100)
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function totalFrom(dates: (string | null | undefined)[], months: { current: string; prior: string }): MatterTotal {
  const keys = dates.map(value => (value ? firmDateKey(value)?.slice(0, 7) ?? null : null))
  const newThisMonth = keys.filter(key => key === months.current).length
  const newPriorMonth = keys.filter(key => key === months.prior).length
  return {
    count: dates.filter(Boolean).length,
    newThisMonth,
    newPriorMonth,
    deltaPercent: percentDelta(newThisMonth, newPriorMonth),
  }
}

export function isOpenMatter(matter: MatterListRow): boolean {
  return stageInfo(matter.stage).group !== 'closed'
}

export function awaitsIntake(matter: MatterListRow): boolean {
  return matter.intake_status !== 'submitted'
}

export function needsAttention(matter: MatterListRow, now: number = Date.now()): boolean {
  const unreviewed =
    (matter.unreviewed_intake_upload_count ?? 0) + (matter.unreviewed_portal_upload_count ?? 0)
  if (unreviewed > 0) return true
  const quiet = matterQuietDays(matter, now)
  return quiet !== null && quiet > QUIET_MATTER_DAYS
}

export function isSigningSoon(matter: MatterListRow, now: number = Date.now()): boolean {
  if (!matter.signing_date) return false
  const at = Date.parse(matter.signing_date)
  if (!Number.isFinite(at)) return false
  const days = Math.floor((at - now) / 86_400_000)
  return days >= 0 && days <= SIGNING_SOON_DAYS
}

function countBy<T extends string>(
  rows: MatterListRow[],
  key: (matter: MatterListRow) => T | null,
): Map<T, number> {
  const counts = new Map<T, number>()
  for (const row of rows) {
    const value = key(row)
    if (value === null) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

export function buildMatterDashboard(
  matters: MatterListRow[],
  now: number = Date.now(),
): MatterDashboardSnapshot {
  const months = monthKeys(firmTodayKey(new Date(now)))
  const open = matters.filter(isOpenMatter)

  const stageCounts = countBy<StageGroup>(open, matter => stageInfo(matter.stage).group)
  // Every group is listed, including the empty ones: a stage bar with gaps in it
  // says something a bar that silently omits them does not.
  const stages: MatterSlice[] = STAGE_GROUP_ORDER.filter(group => group !== 'closed').map(group => ({
    key: group,
    label: STAGE_GROUP_LABELS[group],
    count: stageCounts.get(group) ?? 0,
    percent: share(stageCounts.get(group) ?? 0, open.length),
  }))

  const practiceCounts = countBy(open, matter => (matter.practice_area as string | null) ?? 'unknown')
  const practiceAreas: MatterSlice[] = [...practiceCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === 'unknown' ? 'Unassigned' : practiceAreaLabel(key),
      count,
      percent: share(count, open.length),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const recent = [...matters]
    .sort((a, b) => (matterLastMilestoneAt(b) ?? 0) - (matterLastMilestoneAt(a) ?? 0))
    .slice(0, RECENT_MATTER_LIMIT)

  return {
    open: totalFrom(open.map(m => m.matter_created), months),
    executed: totalFrom(
      matters.map(m => m.documents_executed_at).filter(Boolean),
      months,
    ),
    awaitingIntake: open.filter(awaitsIntake).length,
    needsAttention: open.filter(matter => needsAttention(matter, now)).length,
    signingSoon: open.filter(matter => isSigningSoon(matter, now)).length,
    stages,
    practiceAreas,
    recent,
  }
}
