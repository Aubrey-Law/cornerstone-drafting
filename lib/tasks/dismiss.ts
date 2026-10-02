import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskRow, TaskSource } from '@/lib/tasks/types'

/**
 * Sources whose tasks a sweep or generator writes, and would write again.
 *
 * Deleting one of these used to remove the row outright, and the row was the
 * only thing telling its generator "already said this". The fiduciary and
 * identity sweeps run every tick, so a deleted task was back within minutes;
 * deleting a matter's whole SLA plan regenerated it. So these are dismissed
 * instead: archived and marked skipped — the same pair `isTaskSkipped` reads,
 * and the one SLA's own skip writes — which takes them out of every open
 * queue while leaving the row for the generator to find.
 *
 * `closeout_reason` stays null on purpose. A closeout marker is what
 * `restoreTasksForReopenedRecord` revives when a record reopens, and what the
 * sweeps read as "I retired this myself"; a dismissal is neither.
 */
export const DISMISS_ON_DELETE_SOURCES: readonly TaskSource[] = ['fiduciary', 'identity', 'sla', 'prompt']

export function dismissesOnDelete(source: string | null | undefined): boolean {
  return (DISMISS_ON_DELETE_SOURCES as readonly string[]).includes(source ?? '')
}

export function dismissedPatch(now: Date = new Date()): Partial<TaskRow> & { updated_at: string } {
  const stamp = now.toISOString()
  return { status: 'archived', skipped_at: stamp, closeout_reason: null, updated_at: stamp }
}

/**
 * Remove tasks the way their source needs: hard delete for work a person
 * wrote, dismissal for work a generator would write again. Returns the ids
 * actually removed from the queue either way.
 */
export async function removeTasks(
  admin: SupabaseClient,
  rows: Array<Pick<TaskRow, 'id' | 'source'>>,
): Promise<{ removed: string[]; dismissed: string[]; error: string | null }> {
  const dismissIds = rows.filter(row => dismissesOnDelete(row.source)).map(row => row.id)
  const deleteIds = rows.filter(row => !dismissesOnDelete(row.source)).map(row => row.id)
  const removed: string[] = []
  const dismissed: string[] = []

  if (dismissIds.length > 0) {
    const { data, error } = await admin
      .from('tasks')
      .update(dismissedPatch())
      .in('id', dismissIds)
      .select('id')
    if (error) return { removed, dismissed, error: error.message }
    for (const row of (data ?? []) as Array<{ id: string }>) {
      removed.push(row.id)
      dismissed.push(row.id)
    }
  }
  if (deleteIds.length > 0) {
    const { data, error } = await admin
      .from('tasks')
      .delete()
      .in('id', deleteIds)
      .select('id')
    if (error) return { removed, dismissed, error: error.message }
    for (const row of (data ?? []) as Array<{ id: string }>) removed.push(row.id)
  }
  return { removed, dismissed, error: null }
}
