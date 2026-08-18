import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { firmTodayKey } from '@/lib/firmDate'
import type { TaskRow } from '@/lib/tasks/types'
import { planTimestamp, toPlanTasks } from './plan'
import { addDays } from './schedule'
import {
  PLAN_TASK_COLUMNS,
  type PlanTask,
  type PlanTaskWithMatter,
  type ScheduledPlanTask,
} from './types'

/** Open statuses, in the one task vocabulary. */
const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

/**
 * Sources that carry a firm deadline the SLA boards report on: the dated plan
 * itself, and the stage engine's own tasks, which have carried a `hard_due_at`
 * SLA badge since long before the two systems merged.
 */
const DEADLINE_SOURCES = ['sla', 'stage']

/**
 * The instant a plan day is stored at. Plan rows land exactly on it; a stage
 * task's `hard_due_at` keeps the time of day the matter entered the stage, so a
 * comparison against this can call such a task overdue a few hours early on its
 * own due date. That is the right side to err on for an SLA badge.
 */
function dayBound(dateKey: string): string {
  return planTimestamp(dateKey) ?? `${dateKey}T12:00:00.000Z`
}

/**
 * Client- and automation-owned plan rows consume the clock but are not the
 * firm's to-do list, so the boards that answer "what is on me" filter to
 * owner = 'firm'.
 */
const FIRM_OWNED = 'firm'

/**
 * The matter's generated plan — `tasks` rows with source = 'sla', in plan order.
 *
 * Deliberately narrower than what the plan *view* shows: regeneration and the
 * downstream-shift math reason about the template's own rows, and a hand-added
 * task sitting in the same phase must not make a template swap look unsafe.
 */
export async function fetchPlanTasks(
  admin: SupabaseClient,
  matterId: string,
): Promise<PlanTask[]> {
  const { data, error } = await admin
    .from('tasks')
    .select(PLAN_TASK_COLUMNS)
    .eq('matter_id', matterId)
    .eq('source', 'sla')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return toPlanTasks((data ?? []) as unknown as TaskRow[])
}

/**
 * Everything on the matter's plan board: the generated plan plus any stage or
 * hand-added task that names a phase. This is the list the Plan view groups —
 * one board, so work added by hand stops being invisible next to the template's.
 */
export async function fetchMatterPlan(
  admin: SupabaseClient,
  matterId: string,
): Promise<PlanTask[]> {
  const { data, error } = await admin
    .from('tasks')
    .select(PLAN_TASK_COLUMNS)
    .eq('matter_id', matterId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return toPlanTasks((data ?? []) as unknown as TaskRow[])
}

/**
 * Attach matter and client names. `v_matter_pipeline` carries only hired,
 * unarchived matters, so tasks whose matter has since been archived drop out of
 * the cross-matter boards rather than showing up nameless.
 */
async function withMatterNames(
  admin: SupabaseClient,
  tasks: PlanTask[],
): Promise<PlanTaskWithMatter[]> {
  if (tasks.length === 0) return []
  const matterIds = [...new Set(tasks.map(task => task.matter_id).filter((id): id is string => !!id))]
  if (matterIds.length === 0) return []
  const { data, error } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, matter_name, client_name')
    .in('matter_id', matterIds)
  if (error) throw error

  const byId = new Map<string, { matter_name: string | null; client_name: string | null }>()
  for (const row of data ?? []) {
    byId.set(row.matter_id as string, {
      matter_name: (row.matter_name as string | null) ?? null,
      client_name: (row.client_name as string | null) || null,
    })
  }

  return tasks.flatMap(task => {
    const matter = task.matter_id ? byId.get(task.matter_id) : undefined
    return matter ? [{ ...task, ...matter }] : []
  })
}

/** Open firm tasks across every matter falling due inside the next `days` days. */
export async function fetchUpcomingTasks(
  admin: SupabaseClient,
  options: { days?: number; limit?: number; today?: string } = {},
): Promise<ScheduledPlanTask[]> {
  const today = options.today ?? firmTodayKey()
  const days = options.days ?? 14
  const { data, error } = await admin
    .from('tasks')
    .select(PLAN_TASK_COLUMNS)
    .in('status', OPEN_STATUSES)
    .in('source', DEADLINE_SOURCES)
    .eq('owner', FIRM_OWNED)
    .gte('hard_due_at', dayBound(today))
    .lte('hard_due_at', dayBound(addDays(today, days)))
    .order('hard_due_at', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error

  const withNames = (await withMatterNames(
    admin,
    toPlanTasks((data ?? []) as unknown as TaskRow[]),
  )) as ScheduledPlanTask[]
  return options.limit ? withNames.slice(0, options.limit) : withNames
}

/** Everything past due that nobody has completed or skipped. */
export async function fetchOverdueTasks(
  admin: SupabaseClient,
  options: { limit?: number; today?: string } = {},
): Promise<ScheduledPlanTask[]> {
  const today = options.today ?? firmTodayKey()
  const { data, error } = await admin
    .from('tasks')
    .select(PLAN_TASK_COLUMNS)
    .in('status', OPEN_STATUSES)
    .in('source', DEADLINE_SOURCES)
    .eq('owner', FIRM_OWNED)
    .lt('hard_due_at', dayBound(today))
    .order('hard_due_at', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error

  const withNames = (await withMatterNames(
    admin,
    toPlanTasks((data ?? []) as unknown as TaskRow[]),
  )) as ScheduledPlanTask[]
  return options.limit ? withNames.slice(0, options.limit) : withNames
}
