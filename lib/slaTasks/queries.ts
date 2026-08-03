import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { firmTodayKey } from '@/lib/firmDate'
import { addDays } from './schedule'
import {
  MATTER_TASK_COLUMNS,
  SLA_OPEN_STATUSES,
  type MatterTaskRow,
  type MatterTaskWithMatter,
  type SlaTaskStatus,
} from './types'

/** All tasks on one matter, earliest due first. */
export async function fetchMatterTasks(
  admin: SupabaseClient,
  matterId: string,
  statuses?: SlaTaskStatus[],
): Promise<MatterTaskRow[]> {
  let query = admin
    .from('matter_tasks')
    .select(MATTER_TASK_COLUMNS)
    .eq('matter_id', matterId)
  if (statuses && statuses.length > 0) query = query.in('status', statuses)

  const { data, error } = await query
    .order('due_date', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as MatterTaskRow[]
}

/**
 * Attach matter and client names. `v_matter_pipeline` carries only hired,
 * unarchived matters, so tasks whose matter has since been archived drop out of
 * the cross-matter boards rather than showing up nameless.
 */
async function withMatterNames(
  admin: SupabaseClient,
  tasks: MatterTaskRow[],
): Promise<MatterTaskWithMatter[]> {
  if (tasks.length === 0) return []
  const matterIds = [...new Set(tasks.map(task => task.matter_id))]
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
    const matter = byId.get(task.matter_id)
    return matter ? [{ ...task, ...matter }] : []
  })
}

/** Open tasks across every matter falling due inside the next `days` days. */
export async function fetchUpcomingTasks(
  admin: SupabaseClient,
  options: { days?: number; limit?: number; today?: string } = {},
): Promise<MatterTaskWithMatter[]> {
  const today = options.today ?? firmTodayKey()
  const days = options.days ?? 14
  const { data, error } = await admin
    .from('matter_tasks')
    .select(MATTER_TASK_COLUMNS)
    .in('status', ['pending', 'active'])
    .gte('due_date', today)
    .lte('due_date', addDays(today, days))
    .order('due_date', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error

  const withNames = await withMatterNames(admin, (data ?? []) as unknown as MatterTaskRow[])
  return options.limit ? withNames.slice(0, options.limit) : withNames
}

/** Everything past due that nobody has completed or skipped. */
export async function fetchOverdueTasks(
  admin: SupabaseClient,
  options: { limit?: number; today?: string } = {},
): Promise<MatterTaskWithMatter[]> {
  const today = options.today ?? firmTodayKey()
  const { data, error } = await admin
    .from('matter_tasks')
    .select(MATTER_TASK_COLUMNS)
    .in('status', SLA_OPEN_STATUSES)
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error

  const withNames = await withMatterNames(admin, (data ?? []) as unknown as MatterTaskRow[])
  return options.limit ? withNames.slice(0, options.limit) : withNames
}
