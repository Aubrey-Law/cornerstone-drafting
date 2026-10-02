import { describe, expect, it, vi } from 'vitest'
import { getActionDefinition } from '@/lib/actions/registry'

const actor = { id: '00000000-0000-0000-0000-000000000001' }

describe('resuming personal work dispositions', () => {
  it('deletes only the acting user’s override, leaving source work untouched', async () => {
    const finalEq = vi.fn(async () => ({ error: null }))
    const firstEq = vi.fn(() => ({ eq: finalEq }))
    const remove = vi.fn(() => ({ eq: firstEq }))
    const from = vi.fn(() => ({ delete: remove }))
    const definition = getActionDefinition('work.override')
    const input = definition?.validate({ workKey: 'task:example', state: 'open' }, actor)

    const result = await definition?.execute(input!, {
      admin: { from } as never,
      actor,
      source: 'today',
      idempotencyKey: 'test-resume-override',
    })

    expect(result).toEqual({ workKey: 'task:example', cleared: true })
    expect(from).toHaveBeenCalledWith('work_item_overrides')
    expect(remove).toHaveBeenCalledOnce()
    expect(firstEq).toHaveBeenCalledWith('user_id', actor.id)
    expect(finalEq).toHaveBeenCalledWith('work_key', 'task:example')
  })
})
