import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type { CrmPeopleRow, CrmStageRow } from '@/lib/queries/cornerstoneCrm'

/** A headline count plus how it moved against the prior month. */
export interface CrmTotal {
  count: number
  newThisMonth: number
  newPriorMonth: number
  deltaPercent: number | null
}

export interface CrmSlice {
  key: string
  label: string
  count: number
  percent: number
}

export interface CrmPipelineStage extends CrmSlice {
  isWon: boolean
}

export interface CrmDashboardSnapshot {
  people: CrmTotal
  activePipeline: CrmTotal
  converted: CrmTotal
  /** Share of leads that reached a converted or won state. */
  conversion: { percent: number; converted: number; total: number }
  leadSources: CrmSlice[]
  pipeline: CrmPipelineStage[]
  followUps: { overdue: number; dueToday: number; upcoming: number }
  recentPeople: CrmPeopleRow[]
}

const CONVERTED_LIFECYCLES = new Set(['converted', 'closed_won', 'won', 'client'])

function monthKeys(today: string): { current: string; prior: string } {
  const [year, month] = today.split('-').map(Number)
  const prior = new Date(Date.UTC(year, month - 2, 1))
  return { current: today.slice(0, 7), prior: prior.toISOString().slice(0, 7) }
}

function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) return null
  return Math.round(((current - prior) / prior) * 100)
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function total(rows: CrmPeopleRow[], months: { current: string; prior: string }): CrmTotal {
  const created = rows.map(row => firmDateKey(row.createdAt)?.slice(0, 7) ?? null)
  const newThisMonth = created.filter(key => key === months.current).length
  const newPriorMonth = created.filter(key => key === months.prior).length
  return {
    count: rows.length,
    newThisMonth,
    newPriorMonth,
    deltaPercent: percentDelta(newThisMonth, newPriorMonth),
  }
}

/**
 * Whether a person can move through the lead pipeline at all.
 *
 * `cornerstone_crm_people` holds the whole contact base, not just leads: the
 * contact sync writes a row for every spouse, child, fiduciary and standalone
 * contact, pinned at `new_inquiry` and never advanced. Counting those in the
 * funnel put people who cannot convert into the denominator — several per
 * matter once matter contacts sync — which understated conversion and inflated
 * the active-pipeline and stage-occupancy counts.
 */
export function isPipelinePerson(person: CrmPeopleRow): boolean {
  return person.personKind === 'primary'
}

/** A person is converted once their lifecycle says so or a matter exists. */
export function isConverted(person: CrmPeopleRow, wonStageIds: Set<string>): boolean {
  if (person.lifecycleStatus && CONVERTED_LIFECYCLES.has(person.lifecycleStatus.toLowerCase())) {
    return true
  }
  return person.stageId !== null && wonStageIds.has(person.stageId)
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase())
}

/**
 * Lead volume by acquisition source, largest first. Anything past the top five
 * collapses into "Other" so the legend stays readable on a small card.
 */
function buildLeadSources(rows: CrmPeopleRow[], limit = 5): CrmSlice[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const raw = row.leadSource?.trim() || row.referralSource?.trim() || ''
    const key = raw ? raw.toLowerCase() : 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const head = ordered.slice(0, limit)
  const tail = ordered.slice(limit)
  const slices = head.map(([key, count]) => ({
    key,
    label: key === 'unknown' ? 'Unattributed' : titleCase(key),
    count,
    percent: share(count, rows.length),
  }))
  if (tail.length > 0) {
    const count = tail.reduce((sum, [, value]) => sum + value, 0)
    slices.push({ key: 'other', label: 'Other', count, percent: share(count, rows.length) })
  }
  return slices
}

/** Stage occupancy in the firm's configured stage order. */
function buildPipeline(rows: CrmPeopleRow[], stages: CrmStageRow[]): CrmPipelineStage[] {
  const active = [...stages]
    .filter(stage => stage.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
  return active.map(stage => {
    const count = rows.filter(row => row.stageId === stage.id).length
    return {
      key: stage.id,
      label: stage.name,
      count,
      percent: share(count, rows.length),
      isWon: stage.is_won,
    }
  })
}

export function buildCrmDashboard(input: {
  people: CrmPeopleRow[]
  stages: CrmStageRow[]
  now?: Date
  recentLimit?: number
}): CrmDashboardSnapshot {
  const today = firmTodayKey(input.now)
  const months = monthKeys(today)
  const people = input.people
  const closedStageIds = new Set(
    input.stages.filter(stage => stage.is_closed).map(stage => stage.id),
  )
  const wonStageIds = new Set(input.stages.filter(stage => stage.is_won).map(stage => stage.id))

  // Funnel metrics count leads; the People total and follow-ups cover the whole
  // contact base, which is what those two are asking about.
  const leads = people.filter(isPipelinePerson)
  const open = leads.filter(person => person.stageId === null || !closedStageIds.has(person.stageId))
  const converted = leads.filter(person => isConverted(person, wonStageIds))

  const followUpKeys = people
    .map(person => (person.nextFollowUpAt ? firmDateKey(person.nextFollowUpAt) : null))
    .filter((key): key is string => key !== null)

  return {
    people: total(people, months),
    activePipeline: total(open, months),
    converted: total(converted, months),
    conversion: {
      percent: share(converted.length, leads.length),
      converted: converted.length,
      total: leads.length,
    },
    leadSources: buildLeadSources(leads),
    pipeline: buildPipeline(leads, input.stages),
    followUps: {
      overdue: followUpKeys.filter(key => key < today).length,
      dueToday: followUpKeys.filter(key => key === today).length,
      upcoming: followUpKeys.filter(key => key > today).length,
    },
    recentPeople: [...people]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.recentLimit ?? 8),
  }
}
