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
    owner = 'firm',
    includeArchived = false,
    limit = 500,
  } = options

  const admin = getAdminClient()
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

  if (recordId) {
    // Interpolated into a PostgREST filter string, so it has to be a real id.
    if (!isUuid(recordId)) return []
    query = query.or(`matter_id.eq.${recordId},lead_id.eq.${recordId}`)
  }

  const { data, error } = await query.limit(limit)
  if (error) {
    console.error('fetchTasks:', error.message)
    return []
  }

  const rows = ((data ?? []) as unknown as RawTaskRow[]).map(normalizeRow)
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
