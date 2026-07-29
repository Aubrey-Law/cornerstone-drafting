import type { SupabaseClient } from '@supabase/supabase-js'
import { TASK_COLUMNS } from '@/lib/queries/tasks'
import { nextOccurrence, parseRecurrence } from '@/lib/tasks/recurrence'
import type { ChecklistItem, TaskRow } from '@/lib/tasks/types'

/**
 * Server-side task writes shared by the task routes. `lib/matterActivity.ts` is
 * a browser helper (it reads the session off the client), so activity from an
 * API route is written here against the service-role client instead.
 */

interface Actor {
  id: string | null
  email?: string | null
  name?: string | null
}

/**
 * Record a task event on the matter's (or lead's) activity feed. Best effort —
 * a failed write must never fail the task action the user just took.
 */
export async function logTaskActivity(
  admin: SupabaseClient,
  task: Pick<TaskRow, 'matter_id' | 'lead_id' | 'title' | 'source'>,
  eventType: 'task_created' | 'task_completed',
  actor: Actor,
): Promise<void> {
  const verb = eventType === 'task_completed' ? 'Task completed' : 'Task added'
  const title = `${verb}: ${task.title}`

  try {
    if (task.matter_id) {
      await admin.from('matter_activity').insert({
        matter_id: task.matter_id,
        event_type: eventType,
        title,
        detail: null,
        metadata: { source: task.source },
        actor_id: actor.id,
        actor_email: actor.email ?? null,
        actor_name: actor.name ?? actor.email ?? null,
      })
    } else if (task.lead_id) {
      await admin.from('lead_activity').insert({
        lead_id: task.lead_id,
        event_type: eventType,
        title,
        detail: null,
        actor_id: actor.id,
      })
    }
  } catch (error) {
    console.warn('logTaskActivity skipped:', error)
  }
}

/**
 * Insert the next occurrence of a recurring task once the current one is done.
 * Returns the new row, or null when the cadence is paused, exhausted, or the
 * task does not recur.
 */
export async function createNextOccurrence(
  admin: SupabaseClient,
  task: TaskRow,
): Promise<TaskRow | null> {
  const recurrence = parseRecurrence(task.recurrence)
  if (!recurrence) return null

  const previousDue = task.due_at ?? task.soft_due_at ?? null
  const nextDue = nextOccurrence(recurrence, previousDue)
  if (!nextDue) return null

  const { data, error } = await admin
    .from('tasks')
    .insert({
      title: task.title,
      description: task.description,
      status: 'open',
      priority: task.priority,
      // A repeat of a stage task is firm follow-up work, not engine output.
      source: task.source === 'stage' ? 'cadence' : task.source,
      task_type: task.task_type,
      checklist: (task.checklist ?? []).map((item: ChecklistItem) => ({ text: item.text, done: false })),
      matter_id: task.matter_id,
      lead_id: task.lead_id,
      due_at: nextDue.toISOString(),
      assignee_id: task.assignee_id,
      estimate_minutes: task.estimate_minutes,
      recurrence: task.recurrence,
      template_id: task.template_id,
      created_by: task.created_by,
    })
    .select(TASK_COLUMNS)
    .single()

  if (error) {
    console.error('createNextOccurrence:', error.message)
    return null
  }
  return data as unknown as TaskRow
}

/** The actor fields an API route can build from `requireAdmin`'s user. */
export function actorFrom(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null): Actor {
  if (!user) return { id: null }
  return {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
  }
}
