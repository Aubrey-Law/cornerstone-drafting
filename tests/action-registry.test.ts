import { describe, expect, it } from 'vitest'
import { getActionDefinition, listActionDefinitions } from '@/lib/actions/registry'

describe('shared action registry', () => {
  it('classifies one-click Today actions as internal writes', () => {
    expect(listActionDefinitions()).toEqual(expect.arrayContaining([
      { key: 'task.start', risk: 'internal_write' },
      { key: 'task.complete', risk: 'internal_write' },
      { key: 'work.override', risk: 'internal_write' },
    ]))
  })

  it('validates references before preview or execution', () => {
    expect(() => getActionDefinition('task.complete')?.validate({ taskId: 'not-a-uuid' })).toThrow('valid task')
    expect(() => getActionDefinition('work.override')?.validate({ workKey: 'task:1', state: 'snoozed' })).toThrow('wake time')
  })
})
