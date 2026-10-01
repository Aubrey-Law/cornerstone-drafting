import type { SupabaseClient } from '@supabase/supabase-js'
import { TASK_COLUMNS } from '@/lib/queries/tasks'
import { actorFrom, createNextOccurrence, logTaskActivity } from '@/lib/tasks/server'
import type { ChecklistItem, TaskRow, TaskStatus } from '@/lib/tasks/types'

export function taskStatusStamps(
  status: TaskStatus,
  existing: TaskRow,
  userId: string | null,
): Record<string, unknown> {
  if (status !== 'done') {
    return { status, completed_at: null, completed_by: null, skipped_at: null, closeout_reason: null }
  }
  const recorded = existing.status === 'done' && existing.completed_at
  return {
    status,
    completed_at: recorded ? existing.completed_at : new Date().toISOString(),
    completed_by: recorded ? existing.completed_by : userId,
    skipped_at: null,
    closeout_reason: null,
  }
}

/** Shared status mutation for Today, the task editor, assistant, and automations. */
export async function setTaskStatus(
  admin: SupabaseClient,
  input: {
    taskId: string
    status: TaskStatus
    actor: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null
  },
): Promise<{ task: TaskRow; nextTask: TaskRow | null; before: TaskStatus }> {
  const { data: row, error: loadError } = await admin.from('tasks').select(TASK_COLUMNS)
    .eq('id', input.taskId).maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (!row) throw new Error('Task not found')
  const existing = row as unknown as TaskRow
  const patch = taskStatusStamps(input.status, existing, input.actor?.id ?? null)
  if (input.status === 'done') {
    patch.checklist = ((existing.checklist ?? []) as ChecklistItem[]).map(item => ({ ...item, done: true }))
  }
  const { data, error } = await admin.from('tasks').update(patch).eq('id', input.taskId).select(TASK_COLUMNS).single()
  if (error) throw new Error(error.message)
  const task = data as unknown as TaskRow
  let nextTask: TaskRow | null = null
  if (input.status === 'done' && existing.status !== 'done') {
    await logTaskActivity(admin, task, 'task_completed', actorFrom(input.actor))
    nextTask = await createNextOccurrence(admin, task)
  }
  return { task, nextTask, before: existing.status }
}
