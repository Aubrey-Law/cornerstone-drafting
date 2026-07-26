import type { MatterListRow } from '@/lib/queries/matters'
import { stageInfo, type StageGroup } from '@/types/database'

export type MatterTableFilters = {
  search: string
  practice: string
  stageGroup: StageGroup | 'all'
}

export type MatterSortKey = 'last_activity' | 'newest' | 'oldest' | 'client_asc' | 'client_desc' | 'matter_number'

export const EMPTY_MATTER_TABLE_FILTERS: MatterTableFilters = {
  search: '',
  practice: 'all',
  stageGroup: 'all',
}

/** The pipeline view's newest timestamp is the best available activity signal. */
export function matterLastActivityAt(matter: MatterListRow): number | null {
  const timestamps = [
    matter.documents_executed_at,
    matter.drafts_sent_at,
    matter.intake_submitted_at,
    matter.matter_created,
  ]
    .map(timestamp)
    .filter((value): value is number => value !== null)
  return timestamps.length ? Math.max(...timestamps) : null
}

export function filterAndSortMatters(
  matters: MatterListRow[],
  filters: MatterTableFilters,
  sortKey: MatterSortKey,
): MatterListRow[] {
  const search = normalize(filters.search)
  const practice = normalize(filters.practice)
  const decorated = matters
    .filter(matter => matchesMatter(matter, search, practice, filters.stageGroup))
    .map((matter, index) => ({ matter, index }))

  decorated.sort((left, right) =>
    compareMatters(left.matter, right.matter, sortKey) || left.index - right.index,
  )
  return decorated.map(({ matter }) => matter)
}

function matchesMatter(
  matter: MatterListRow,
  search: string,
  practice: string,
  stageGroup: StageGroup | 'all',
): boolean {
  if (search) {
    const haystack = [
      matter.matter_number,
      matter.client_name,
      matter.client_email,
      matter.client_phone,
      matter.matter_name,
      matter.practice_area,
      matter.stage,
      matter.intake_status,
    ].some(value => normalize(value).includes(search))
    if (!haystack) return false
  }
  if (practice !== '' && practice !== 'all' && normalize(matter.practice_area) !== practice) return false
  return stageGroup === 'all' || stageInfo(matter.stage).group === stageGroup
}

function compareMatters(left: MatterListRow, right: MatterListRow, sortKey: MatterSortKey): number {
  if (sortKey === 'last_activity') {
    return compareNullable(matterLastActivityAt(left), matterLastActivityAt(right), (a, b) => b - a)
  }
  if (sortKey === 'newest') return compareNullable(timestamp(left.matter_created), timestamp(right.matter_created), (a, b) => b - a)
  if (sortKey === 'oldest') return compareNullable(timestamp(left.matter_created), timestamp(right.matter_created), (a, b) => a - b)
  if (sortKey === 'client_asc') return compareNullable(clientName(left), clientName(right), (a, b) => a.localeCompare(b))
  if (sortKey === 'client_desc') return compareNullable(clientName(left), clientName(right), (a, b) => b.localeCompare(a))
  return compareNullable(matterNumber(left), matterNumber(right), (a, b) => a.localeCompare(b))
}

function clientName(matter: MatterListRow): string | null {
  const value = matter.client_name?.trim()
  return value || null
}

function matterNumber(matter: MatterListRow): string | null {
  const value = matter.matter_number?.trim()
  return value || null
}

function compareNullable<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compare(left, right)
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? ''
}
