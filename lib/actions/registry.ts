import { isUuid } from '@/lib/queries/tasks'
import { setTaskStatus } from '@/lib/tasks/statusMutation'
import type { ActionDefinition } from '@/lib/actions/types'

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Action input must be an object')
  return value as Record<string, unknown>
}

function taskInput(value: unknown): { taskId: string } {
  const input = objectInput(value)
  if (typeof input.taskId !== 'string' || !isUuid(input.taskId)) throw new Error('A valid task is required')
  return { taskId: input.taskId }
}

function overrideInput(value: unknown): { workKey: string; state: 'blocked' | 'snoozed'; snoozedUntil: string | null } {
  const input = objectInput(value)
  const workKey = typeof input.workKey === 'string' ? input.workKey.trim() : ''
  const state = input.state === 'snoozed' ? 'snoozed' : input.state === 'blocked' ? 'blocked' : null
  const snoozedUntil = typeof input.snoozedUntil === 'string' && !Number.isNaN(Date.parse(input.snoozedUntil))
    ? new Date(input.snoozedUntil).toISOString() : null
  if (workKey.length < 3 || workKey.length > 300 || !state) throw new Error('A valid work override is required')
  if (state === 'snoozed' && !snoozedUntil) throw new Error('Snoozed work needs a wake time')
  return { workKey, state, snoozedUntil }
}

const definitions: ActionDefinition[] = [
  {
    key: 'task.start',
    risk: 'internal_write',
    validate: taskInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('tasks').select('id, title, status, updated_at').eq('id', input.taskId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Task not found')
      return { before: data, after: { status: 'in_progress' } }
    },
    async execute(input, context) {
      return setTaskStatus(context.admin, { taskId: input.taskId, status: 'in_progress', actor: context.actor })
    },
  } as ActionDefinition<{ taskId: string }>,
  {
    key: 'task.complete',
    risk: 'internal_write',
    validate: taskInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('tasks').select('id, title, status, updated_at').eq('id', input.taskId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Task not found')
      return { before: data, after: { status: 'done' } }
    },
    async execute(input, context) {
      return setTaskStatus(context.admin, { taskId: input.taskId, status: 'done', actor: context.actor })
    },
  } as ActionDefinition<{ taskId: string }>,
  {
    key: 'work.override',
    risk: 'internal_write',
    validate: overrideInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('work_item_overrides')
        .select('state, snoozed_until, assigned_to, updated_at')
        .eq('user_id', context.actor.id).eq('work_key', input.workKey).maybeSingle()
      if (error) throw new Error(error.message)
      return {
        before: data,
        after: { workKey: input.workKey, state: input.state, snoozedUntil: input.snoozedUntil },
      }
    },
    async execute(input, context) {
      const { data, error } = await context.admin.from('work_item_overrides').upsert({
        user_id: context.actor.id,
        work_key: input.workKey,
        state: input.state,
        snoozed_until: input.state === 'snoozed' ? input.snoozedUntil : null,
      }, { onConflict: 'user_id,work_key' }).select('id, work_key, state, snoozed_until').single()
      if (error) throw new Error(error.message)
      return data
    },
  } as ActionDefinition<{ workKey: string; state: 'blocked' | 'snoozed'; snoozedUntil: string | null }>,
]

export function getActionDefinition(key: string): ActionDefinition | null {
  return definitions.find(definition => definition.key === key) ?? null
}

export function listActionDefinitions() {
  return definitions.map(({ key, risk }) => ({ key, risk }))
}
