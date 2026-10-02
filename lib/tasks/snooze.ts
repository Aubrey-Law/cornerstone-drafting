import type { TaskRow } from '@/lib/tasks/types'

/**
 * Where a snooze lands: the task's working date pushed out by `days`, keeping
 * the time of day. A task with no date is pushed from now.
 *
 * Shared by the single-row snooze menu and the bulk route so a row snoozed on
 * its own and the same row snoozed in a selection land on the same date.
 */
export function snoozedDueAt(
  task: Pick<TaskRow, 'due_at' | 'soft_due_at'>,
  days: number,
  now: Date = new Date(),
): string {
  const next = new Date(task.due_at ?? task.soft_due_at ?? now.toISOString())
  next.setDate(next.getDate() + days)
  return next.toISOString()
}
