import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { parseRecurrence } from '@/lib/tasks/recurrence'
import {
  EMPTY_TASK_COUNTS,
  compareTasks,
  isTaskOverdue,
  taskDueGroup,
  type ChecklistItem,
  type TaskCounts,
  type TaskDueFields,
  type TaskOwner,
  type TaskRow,
  type TaskSource,
  type TaskStatus,
} from '@/lib/tasks/types'
import { PLAN_TASK_COLUMNS } from '@/lib/slaTasks/types'

/**
 * One column list for every task surface. It is the plan's list because the
 * plan is no longer a separate table: a queue row and a plan row are the same
 * row, read by the same query, and splitting the projection would just
 * reintroduce the seam this consolidated away.
 */
export const TASK_COLUMNS = PLAN_TASK_COLUMNS

export type TaskScope = 'mine' | 'team' | 'unassigned' | 'all'

export interface FetchTasksOptions {
  scope?: TaskScope
  /**
   * Whose work to return. Defaults to the firm's: a plan task owned by the
   * client ("Client signs engagement agreement") or by an automation belongs on
   * the plan board, not in anybody's queue. Pass 'all' for the plan view.
   */
  owner?: TaskOwner | 'all'
  /** Include archived tasks — skipped plan rows, which the plan still shows. */
  includeArchived?: boolean
  /** The signed-in user, required to resolve the `mine` scope. */
  viewerId?: string | null
  assignee?: string | null
  source?: TaskSource | 'all' | null
  status?: 'open' | 'done' | 'all' | null
  /** A matter id or lead (client_intake) id — matches either relation. */
  recordId?: string | null
  /** Restrict to these matters — a day's appointments, say. An empty list matches nothing. */
  matterIds?: string[] | null
  /** Only rows with no due date at all: the complement of `fetchDueTasks`. */
  undated?: boolean
  /** Only rows carrying an estimate, for the surfaces that schedule work. */
  hasEstimate?: boolean
  /** Case-insensitive substrings, any of which may appear in the title. */
  titleLike?: string[] | null
  /** Only rows the stage engine drives — the ones carrying a `stage_key`. */
  hasStageKey?: boolean
  /**
   * Read every matching row in pages instead of the first `limit` of them.
   *
   * For the surfaces that mean "all of it" — the Tasks page shows the firm's
   * whole open queue, and a `limit` there does not shorten the list so much as
   * pick an arbitrary part of it.
   */
  all?: boolean
  limit?: number
}

type RawTaskRow = Omit<TaskRow, 'checklist' | 'recurrence' | 'record_name' | 'assignee_name'> & {
  checklist: unknown
  recurrence: unknown
}

const OPEN_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    if (typeof raw.text !== 'string') return []
    return [{ text: raw.text, done: raw.done === true }]
  })
}

function normalizeRow(row: RawTaskRow): TaskRow {
  return {
    ...row,
    checklist: normalizeChecklist(row.checklist),
    recurrence: parseRecurrence(row.recurrence),
  }
}

/**
 * Attach the display name of each task's record and assignee. Kept out of the
 * SQL because a task points at either `matters` or `client_intake`, which
 * PostgREST cannot express as one embedded relation.
 */
async function attachDisplayNames(rows: TaskRow[]): Promise<TaskRow[]> {
  if (rows.length === 0) return []
  const admin = getAdminClient()

  const matterIds = [...new Set(rows.map(r => r.matter_id).filter((id): id is string => Boolean(id)))]
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter((id): id is string => Boolean(id)))]
  const userIds = [...new Set(rows.map(r => r.assignee_id).filter((id): id is string => Boolean(id)))]

  // `matters` has no client name of its own — `v_matter_pipeline` builds one by
  // joining `client_intake` on `client_intake_id`, and this does the same. The
  // view is not used directly because it drops archived matters, and a task on
  // an archived matter should still say which matter it is.
  const matterRows = await (async () => {
    if (matterIds.length === 0) return []
    const { data, error } = await admin
      .from('matters')
      .select('id, name, client_intake_id')
      .in('id', matterIds)
    if (error) {
      console.error('attachDisplayNames matters:', error.message)
      return []
    }
    return (data ?? []) as Array<{ id: string; name: string | null; client_intake_id: string | null }>
  })()

  // One lookup for both the leads tasks point at directly and the people behind
  // the matters, so a matter-linked task costs no extra round trip.
  const intakeIds = [
    ...new Set([
      ...leadIds,
      ...matterRows.map(m => m.client_intake_id).filter((id): id is string => Boolean(id)),
    ]),
  ]

  const [leads, users] = await Promise.all([
    intakeIds.length
      ? admin.from('client_intake').select('id, full_name, first_name, last_name, email').in('id', intakeIds)
      : Promise.resolve({ data: [] as Array<Record<string, string | null>>, error: null }),
    userIds.length
      ? admin.from('users').select('id, display_name, email').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }>, error: null }),
  ])

  // Logged rather than swallowed: selecting a column that does not exist blanks
  // every label at once and looks exactly like "these tasks have no matter",
  // which is how a bad `matters.client_name` select went unnoticed.
  if (leads.error) console.error('attachDisplayNames client_intake:', leads.error.message)
  if (users.error) console.error('attachDisplayNames users:', users.error.message)

  const leadNames = new Map<string, string | null>()
  for (const l of (leads.data ?? []) as Array<Record<string, string | null>>) {
    const full = l.full_name?.trim()
      || [l.first_name, l.last_name].filter(Boolean).join(' ').trim()
      || l.email
      || null
    leadNames.set(l.id as string, full)
  }

  const matterNames = new Map<string, string | null>()
  for (const m of matterRows) {
    const person = m.client_intake_id ? leadNames.get(m.client_intake_id) : null
    // `||`, not `??`: the view's client name is a trimmed concat that comes back
    // as '' when the intake row carries no first or last name.
    matterNames.set(m.id, (person || '').trim() || (m.name || '').trim() || null)
  }

  const userNames = new Map<string, string | null>()
  for (const u of (users.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
    userNames.set(u.id, u.display_name ?? u.email ?? null)
  }

  return rows.map(row => ({
    ...row,
    record_name: row.matter_id
      ? matterNames.get(row.matter_id) ?? null
      : row.lead_id
        ? leadNames.get(row.lead_id) ?? null
        : null,
    assignee_name: row.assignee_id ? userNames.get(row.assignee_id) ?? null : null,
  }))
}

/**
 * Every clause that means "this record" for a task read.
 *
 * A lead's plan is generated against the `matters` row `ensure_lead_matter`
 * creates for it, so those tasks carry that matter's id — not the intake id the
 * lead is known by everywhere else. `fetchTasksForLead` passed the intake id and
 * matched nothing: on 2026-08-24 the lead Tasks tab and its count badge read
 * zero on records carrying 43 open tasks each. `lib/tasks/closeout.ts` already
 * knew this and matched both columns; the read side did not.
 */
async function recordClauses(admin: SupabaseClient, recordId: string): Promise<string[]> {
  const clauses = [`matter_id.eq.${recordId}`, `lead_id.eq.${recordId}`]
  // One extra lookup, and only when a record is named. A matter id matches
  // nothing here, so this costs a miss on the matter path and fixes the lead one.
  const { data } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', recordId)
    .maybeSingle()
  const leadMatterId = (data as { id: string } | null)?.id
  if (leadMatterId) clauses.push(`matter_id.eq.${leadMatterId}`)
  return clauses
}

/**
 * The one query behind every task surface. Callers narrow it with scope,
 * source, status and record filters; the sort is always by effective due date.
 */
export async function fetchTasks(options: FetchTasksOptions = {}): Promise<TaskRow[]> {
  const {
    scope = 'all',
    viewerId = null,
    assignee = null,
    source = null,
    status = 'open',
    recordId = null,
    matterIds = null,
    undated = false,
    hasEstimate = false,
    titleLike = null,
    hasStageKey = false,
    all = false,
    owner = 'firm',
    includeArchived = false,
    limit = 500,
  } = options

  if (matterIds && matterIds.length === 0) return []
  // Interpolated into a PostgREST filter string, so it has to be a real id.
  if (recordId && !isUuid(recordId)) return []

  const admin = getAdminClient()
  const recordFilter = recordId ? (await recordClauses(admin, recordId)).join(',') : null

  // Rebuilt per page: a PostgREST builder is spent once it is awaited.
  const buildQuery = () => {
    let query = admin.from('tasks').select(TASK_COLUMNS)

    if (!includeArchived) query = query.neq('status', 'archived')
    if (status === 'open') query = query.in('status', OPEN_STATUSES)
    else if (status === 'done') query = query.eq('status', 'done')

    if (source && source !== 'all') query = query.eq('source', source)
    if (owner !== 'all') query = query.eq('owner', owner)

    if (assignee) query = query.eq('assignee_id', assignee)
    else if (scope === 'mine' && viewerId) query = query.eq('assignee_id', viewerId)
    else if (scope === 'unassigned') query = query.is('assignee_id', null)
    else if (scope === 'team' && viewerId) query = query.neq('assignee_id', viewerId)

    if (recordFilter) query = query.or(recordFilter)
    if (matterIds) query = query.in('matter_id', matterIds)

    // The three columns `effectiveDueAt` reads, so "no due date" here means the
    // same thing it means everywhere else.
    if (undated) {
      query = query.is('due_at', null).is('soft_due_at', null).is('hard_due_at', null)
    }
    if (hasEstimate) query = query.not('estimate_minutes', 'is', null)
    if (hasStageKey) query = query.not('stage_key', 'is', null)
    // `ilikeAnyOf` rather than an `or=` string: `recordId` already owns the one
    // `or=` parameter a request can carry, and two would collide.
    if (titleLike && titleLike.length > 0) {
      query = query.ilikeAnyOf('title', titleLike.map(term => `%${term}%`))
    }

    // Ordered on every path, not just the paged one. An unordered `limit` is
    // what made a capped read arbitrary in the first place; ordering by the
    // stored due date means a cap keeps the most urgent rows and drops the
    // furthest-off ones. `id` makes it a total order, which paging needs —
    // two tasks can share a due date, and `effective_due_at` is null on most
    // of them.
    return query.order('effective_due_at', { nullsFirst: false }).order('id')
  }

  const rows: RawTaskRow[] = []
  if (all) {
    for (let offset = 0; offset < TASK_READ_CEILING; offset += TASK_PAGE_SIZE) {
      const { data, error } = await buildQuery().range(offset, offset + TASK_PAGE_SIZE - 1)
      if (error) {
        console.error('fetchTasks:', error.message)
        return []
      }
      const page = (data ?? []) as unknown as RawTaskRow[]
      rows.push(...page)
      if (page.length < TASK_PAGE_SIZE) break
      if (offset + TASK_PAGE_SIZE >= TASK_READ_CEILING) {
        console.error(
          `fetchTasks: stopped at the ${TASK_READ_CEILING}-row ceiling, so this list is incomplete.`,
        )
      }
    }
  } else {
    const { data, error } = await buildQuery().limit(limit)
    if (error) {
      console.error('fetchTasks:', error.message)
      return []
    }
    rows.push(...((data ?? []) as unknown as RawTaskRow[]))
  }

  const named = await attachDisplayNames(rows.map(normalizeRow))
  return named.sort(compareTasks)
}

/** Far above the ~30 rows a day's queue holds; a breach means something is wrong. */
export const DUE_TASK_LIMIT = 500

/** One page of a `fetchTasks({ all: true })` read. */
export const TASK_PAGE_SIZE = 500

/** A runaway guard on paged reads, not a display limit; reaching it is logged. */
export const TASK_READ_CEILING = 20_000

/**
 * The firm's open tasks that are already due — the only ones the Today queue
 * can show.
 *
 * Today used to read `fetchTasks({ status: 'open', limit: 500 })` and pick the
 * due ones out in JavaScript. That works while the firm has fewer than 500 open
 * tasks and silently stops working after: on 2026-08-24 there were 1,024, an
 * unordered `limit` returned an arbitrary 500 of them, and **26 of the 27
 * overdue tasks never reached the page**. The nav badge counted the same tasks
 * through `fetchTaskCounts` (limit 2,000) and said 27, so the two surfaces
 * disagreed by 26 with nothing to show the reader which was right.
 *
 * Asking the database for the due window instead makes the answer exact: it is
 * a filter, not a slice, so nothing can fall off the end of it. `tasks
 * .effective_due_at` (20261016000000) is the same `coalesce` `effectiveDueAt()`
 * reads, stored so the database can filter and sort on it.
 */
export async function fetchDueTasks(through: string): Promise<TaskRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tasks')
    .select(TASK_COLUMNS)
    .in('status', OPEN_STATUSES)
    .eq('owner', 'firm')
    .lte('effective_due_at', through)
    .order('effective_due_at')
    .limit(DUE_TASK_LIMIT)

  if (error) {
    console.error('fetchDueTasks:', error.message)
    return []
  }

  const rows = ((data ?? []) as unknown as RawTaskRow[]).map(normalizeRow)
  // The bug this function exists to fix was a silent truncation. If the cap is
  // ever reached, say so rather than shipping a short queue that looks complete.
  if (rows.length === DUE_TASK_LIMIT) {
    console.error(
      `fetchDueTasks: hit the ${DUE_TASK_LIMIT}-row cap, so the Today queue is incomplete. Raise DUE_TASK_LIMIT or page this read.`,
    )
  }
  const named = await attachDisplayNames(rows)
  return named.sort(compareTasks)
}

export async function fetchTasksForMatter(matterId: string, status: 'open' | 'done' | 'all' = 'all') {
  return fetchTasks({ recordId: matterId, status, limit: 200 })
}

export async function fetchTasksForLead(leadId: string, status: 'open' | 'done' | 'all' = 'all') {
  return fetchTasks({ recordId: leadId, status, limit: 200 })
}

/**
 * The open task for whatever stage a record is in — what the stage card reads.
 *
 * Not filtered to source = 'stage': when a matter enters a stage the plan
 * already has a task for, the stage engine attaches its checklist to that plan
 * row rather than creating a second one, so the stage's task can be either
 * source. What identifies it is carrying a `stage_key`.
 */
export async function fetchOpenStageTasksForRecord(recordId: string): Promise<TaskRow[]> {
  const tasks = await fetchTasks({ recordId, status: 'open', limit: 200 })
  return tasks.filter(task => task.stage_key !== null).slice(0, 50)
}

/** Counts behind the nav badge, the scope segmented control and the Today page. */
export async function fetchTaskCounts(viewerId: string | null = null): Promise<TaskCounts> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tasks')
    .select('id, status, due_at, soft_due_at, hard_due_at, assignee_id')
    .in('status', OPEN_STATUSES)
    .eq('owner', 'firm')
    .limit(2000)

  if (error) {
    console.error('fetchTaskCounts:', error.message)
    return EMPTY_TASK_COUNTS
  }

  // Only the due/status/assignee fields matter here, so the rows are counted
  // through the same grouping helpers without a full task fetch.
  const rows = (data ?? []) as unknown as Array<TaskDueFields & { assignee_id: string | null }>
  const now = new Date()

  return {
    overdue: rows.filter(row => isTaskOverdue(row, now)).length,
    today: rows.filter(row => taskDueGroup(row, now) === 'today').length,
    open: rows.length,
    mine: viewerId ? rows.filter(row => row.assignee_id === viewerId).length : 0,
    team: viewerId ? rows.filter(row => row.assignee_id && row.assignee_id !== viewerId).length : 0,
    unassigned: rows.filter(row => !row.assignee_id).length,
  }
}

export async function fetchTaskTemplates() {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('task_templates')
    .select('id, name, description, items, created_at')
    .is('archived_at', null)
    .order('name')

  if (error) {
    console.error('fetchTaskTemplates:', error.message)
    return []
  }
  return (data ?? []) as Array<{
    id: string
    name: string
    description: string | null
    items: Array<{ text: string; offset_days?: number; priority?: 'high' | 'normal' | 'low' }>
    created_at: string
  }>
}

/** Staff who can own a task — the assignee dropdown. */
export async function fetchTaskAssignees() {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('id, display_name, email')
    .in('role', ['attorney', 'admin', 'va', 'staff'])
    .order('display_name')

  if (error) {
    console.error('fetchTaskAssignees:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>).map(u => ({
    id: u.id,
    name: u.display_name ?? u.email ?? 'Unnamed',
  }))
}
