import { describe, expect, it } from 'vitest'
import { getActionDefinition, listActionDefinitions } from '@/lib/actions/registry'

describe('shared action registry', () => {
  const actor = { id: '00000000-0000-0000-0000-000000000001' }

  it('classifies one-click Today actions as internal writes', () => {
    expect(listActionDefinitions()).toEqual(expect.arrayContaining([
      { key: 'task.start', risk: 'internal_write' },
      { key: 'task.complete', risk: 'internal_write' },
      { key: 'work.override', risk: 'internal_write' },
      { key: 'task.create', risk: 'internal_write' },
      { key: 'task.delegate', risk: 'internal_write' },
      { key: 'note.create', risk: 'internal_write' },
      { key: 'calendar.hold.create', risk: 'internal_write' },
      { key: 'email.draft.send', risk: 'external_write' },
      { key: 'matter.stage.transition', risk: 'legal_financial' },
      { key: 'workflow.enqueue', risk: 'internal_write' },
      { key: 'email.draft.prepare', risk: 'prepare' },
      { key: 'billing.reminders.prepare', risk: 'prepare' },
    ]))
  })

  it('validates references before preview or execution', () => {
    expect(() => getActionDefinition('task.complete')?.validate({ taskId: 'not-a-uuid' }, actor)).toThrow('valid task')
    expect(() => getActionDefinition('work.override')?.validate({ workKey: 'task:1', state: 'snoozed' }, actor)).toThrow('wake time')
    expect(() => getActionDefinition('email.draft.send')?.validate({ draftId: 'not-a-uuid' }, actor)).toThrow('valid identifier')
    expect(() => getActionDefinition('workflow.enqueue')?.validate({ type: 'delete_everything', matterId: actor.id, dedupeKey: 'bad' }, actor)).toThrow('allowlisted')
  })

  it('drops prompt-injected keys from task proposals', () => {
    const input = getActionDefinition('task.create')?.validate({
      title: 'Call client',
      matter_id: '00000000-0000-0000-0000-000000000002',
      action_key: 'prohibited.delete_everything',
      recipient: 'attacker@example.com',
    }, actor) as Record<string, unknown>
    expect(input.title).toBe('Call client')
    expect(input).not.toHaveProperty('action_key')
    expect(input).not.toHaveProperty('recipient')
  })
})
