import { describe, expect, it } from 'vitest'
import { getActionDefinition, listActionDefinitions } from '@/lib/actions/registry'
import { resolveCommandCenterDone } from '@/lib/work/commandCenterDone'
import { findMidDayCriticalItems } from '@/lib/work/midDayCritical'
import type { WorkItem } from '@/lib/work/types'

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:1',
    sourceType: 'task',
    sourceIds: ['00000000-0000-4000-8000-000000000001'],
    evidence: [],
    record: { type: 'matter', id: 'm1', name: 'Jordan Client' },
    title: 'Sample work',
    actionLabel: 'Open',
    href: '/admin/tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [],
    estimateMinutes: 15,
    ...overrides,
  }
}

describe('Command Center Done mapping', () => {
  it('registers honest Done actions as internal writes', () => {
    expect(listActionDefinitions()).toEqual(expect.arrayContaining([
      { key: 'portal.messages.mark_read', risk: 'internal_write' },
      { key: 'sms.thread.mark_read', risk: 'internal_write' },
      { key: 'email.triage.dismiss', risk: 'internal_write' },
      { key: 'matter.uploads.mark_reviewed', risk: 'internal_write' },
    ]))
  })

  it('maps communications and document review to registry actions', () => {
    expect(resolveCommandCenterDone(item({
      sourceType: 'portal_message',
      sourceIds: ['00000000-0000-4000-8000-000000000010'],
    }) )?.actionKey).toBe('portal.messages.mark_read')

    expect(resolveCommandCenterDone(item({
      sourceType: 'sms',
      sourceIds: ['+15551234567'],
    }) )?.actionKey).toBe('sms.thread.mark_read')

    expect(resolveCommandCenterDone(item({
      sourceType: 'email',
      sourceIds: ['00000000-0000-4000-8000-000000000011'],
    }) )?.actionKey).toBe('email.triage.dismiss')

    expect(resolveCommandCenterDone(item({
      sourceType: 'document_review',
      sourceIds: ['00000000-0000-4000-8000-000000000012'],
    }) )?.actionKey).toBe('matter.uploads.mark_reviewed')
  })

  it('defers firm billing ledger cards and snoozes invoice follow-ups', () => {
    expect(resolveCommandCenterDone(item({
      sourceType: 'billing',
      workKey: 'billing:unbilled:to-invoice',
    }))).toBeNull()

    const followUp = resolveCommandCenterDone(item({
      sourceType: 'billing',
      workKey: 'invoice:abc:follow-up',
    }))
    expect(followUp?.actionKey).toBe('work.override')
    expect(followUp?.planOnly).toBe(true)
  })

  it('validates new Done action inputs', () => {
    const actor = { id: '00000000-0000-0000-0000-000000000001' }
    expect(() => getActionDefinition('portal.messages.mark_read')?.validate({ matterId: 'bad' }, actor))
      .toThrow('valid identifier')
    expect(() => getActionDefinition('sms.thread.mark_read')?.validate({ phone: '' }, actor))
      .toThrow('phone')
    expect(() => getActionDefinition('email.triage.dismiss')?.validate({ threadId: 'bad' }, actor))
      .toThrow('valid identifier')
  })
})

describe('mid-day critical interrupt', () => {
  it('surfaces only firm-owned critical work missing from the committed plan', () => {
    const critical = item({
      workKey: 'task:critical-new',
      priorityBand: 0,
      title: 'Hard deadline appeared',
    })
    const planned = item({
      workKey: 'task:planned',
      priorityBand: 0,
      title: 'Already on plan',
    })
    const waiting = item({
      workKey: 'task:waiting',
      priorityBand: 0,
      owner: 'client',
      state: 'waiting',
    })

    expect(findMidDayCriticalItems([critical, planned, waiting], ['task:planned']).map(row => row.workKey))
      .toEqual(['task:critical-new'])
  })
})
