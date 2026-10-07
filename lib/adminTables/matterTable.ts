import type { MatterListRow } from '@/lib/queries/matters'
import { isClosedMatter } from '@/lib/matters/closedMatter'
import { STAGES, stageInfo, type StageGroup } from '@/types/database'
import { compareNullable, normalizeSearchText, stableSort, timestamp } from '@/lib/collections'

export type MatterTableFilters = {
  search: string
  practice: string
  stageGroup: StageGroup | 'all'
  /**
   * Closed matters are out of the list unless this is on. They are finished
   * work — nothing on one is waiting for anybody — and leaving them in is what
   * made the list longer every month without ever getting more useful. The
   * Closed toggle brings them back when someone needs to look one up.
   */
  includeClosed: boolean
}

export type MatterSortKey =
  | 'last_activity' | 'last_activity_oldest' | 'newest' | 'oldest'
  | 'client_asc' | 'client_desc' | 'matter_number' | 'matter_number_desc'
  | 'practice_asc' | 'practice_desc' | 'stage_asc' | 'stage_desc' | 'intake_asc' | 'intake_desc'

export const EMPTY_MATTER_TABLE_FILTERS: MatterTableFilters = {
  search: '',
  practice: 'all',
  stageGroup: 'all',
  includeClosed: false,
}

export type MatterListView = 'board' | 'table'

export const MATTER_LIST_VIEW_KEY = 'cornerstone.admin.mattersView'

/** The table is the default so the list keeps the shape it has always had. */
export function readMatterListView(): MatterListView {
  if (typeof window === 'undefined') return 'table'
  try {
    return window.localStorage.getItem(MATTER_LIST_VIEW_KEY) === 'board' ? 'board' : 'table'
  } catch {
    return 'table'
  }
}

export function writeMatterListView(view: MatterListView) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MATTER_LIST_VIEW_KEY, view)
  } catch {
    /* ignore */
  }
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
  const search = normalizeSearchText(filters.search)
  const practice = normalizeSearchText(filters.practice)
  const filtered = matters.filter(
    matter =>
      (filters.includeClosed || !isClosedMatter(matter))
      && matchesMatter(matter, search, practice, filters.stageGroup),
  )
  return stableSort(filtered, (left, right) => compareMatters(left, right, sortKey))
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
  if (sortKey === 'last_activity_oldest') {
    return compareNullable(matterLastActivityAt(left), matterLastActivityAt(right), (a, b) => a - b)
  }
  if (sortKey === 'newest') return compareNullable(timestamp(left.matter_created), timestamp(right.matter_created), (a, b) => b - a)
  if (sortKey === 'oldest') return compareNullable(timestamp(left.matter_created), timestamp(right.matter_created), (a, b) => a - b)
  if (sortKey === 'client_asc') return compareNullable(clientName(left), clientName(right), (a, b) => a.localeCompare(b))
  if (sortKey === 'client_desc') return compareNullable(clientName(left), clientName(right), (a, b) => b.localeCompare(a))
  if (sortKey === 'practice_asc') return compareNullable(text(left.practice_area), text(right.practice_area), (a, b) => a.localeCompare(b))
  if (sortKey === 'practice_desc') return compareNullable(text(left.practice_area), text(right.practice_area), (a, b) => b.localeCompare(a))
  if (sortKey === 'stage_asc') return stageOrder(left) - stageOrder(right)
  if (sortKey === 'stage_desc') return stageOrder(right) - stageOrder(left)
  if (sortKey === 'intake_asc') return compareNullable(text(left.intake_status), text(right.intake_status), (a, b) => a.localeCompare(b))
  if (sortKey === 'intake_desc') return compareNullable(text(left.intake_status), text(right.intake_status), (a, b) => b.localeCompare(a))
  if (sortKey === 'matter_number_desc') return compareNullable(matterNumber(left), matterNumber(right), (a, b) => b.localeCompare(a))
  return compareNullable(matterNumber(left), matterNumber(right), (a, b) => a.localeCompare(b))
}

function text(value: string | null | undefined): string | null {
  return value?.trim() || null
}

/** Pipeline position, so Stage sorts by progress rather than alphabetically. */
function stageOrder(matter: MatterListRow): number {
  const index = STAGES.findIndex(stage => stage.key === matter.stage)
  return index === -1 ? STAGES.length : index
}

function clientName(matter: MatterListRow): string | null {
  const value = matter.client_name?.trim()
  return value || null
}

function matterNumber(matter: MatterListRow): string | null {
  const value = matter.matter_number?.trim()
  return value || null
}

function normalize(value: string | null | undefined): string {
  return normalizeSearchText(value)
}

export const MATTER_STAGE_GROUPS: StageGroup[] = ['early', 'active', 'work', 'done', 'closed']

export const MATTER_SORT_KEYS: MatterSortKey[] = [
  'last_activity', 'last_activity_oldest', 'newest', 'oldest', 'client_asc', 'client_desc',
  'matter_number', 'matter_number_desc', 'practice_asc', 'practice_desc',
  'stage_asc', 'stage_desc', 'intake_asc', 'intake_desc',
]

/**
 * Loose input (a URL query string, or a tool call's arguments) read as list
 * filters, so an export and the matters list it mirrors narrow by the same
 * vocabulary. Anything unrecognized falls back rather than throwing: a request
 * for `stage: "somewhere"` returns every stage, not an error.
 */
export function matterTableFiltersFrom(input: {
  search?: unknown
  practice?: unknown
  stage?: unknown
  closed?: unknown
}): MatterTableFilters {
  const stage = typeof input.stage === 'string' ? input.stage : ''
  return {
    search: typeof input.search === 'string' ? input.search.trim() : '',
    practice: typeof input.practice === 'string' && input.practice.trim() ? input.practice.trim() : 'all',
    stageGroup: (MATTER_STAGE_GROUPS as string[]).includes(stage) ? (stage as StageGroup) : 'all',
    // Anything but an explicit yes leaves closed matters out, so a tool call
    // that says nothing about them gets the list the page shows.
    includeClosed: input.closed === true || input.closed === '1' || input.closed === 'true',
  }
}

export function matterSortKeyFrom(value: unknown, fallback: MatterSortKey = 'client_asc'): MatterSortKey {
  return typeof value === 'string' && (MATTER_SORT_KEYS as string[]).includes(value)
    ? (value as MatterSortKey)
    : fallback
}
