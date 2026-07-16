import { describe, expect, it } from 'vitest'

import { chatTitleFromMessage } from '@/lib/assistantChats'
import { messagesFromPersisted } from '@/app/admin/assistant/components/useAssistantStream'

describe('assistant chat titles', () => {
  it('uses the first non-empty line', () => {
    expect(chatTitleFromMessage('Draft a follow-up email\nfor the Smith matter')).toBe('Draft a follow-up email')
    expect(chatTitleFromMessage('\n\n  Plan my day  \n')).toBe('Plan my day')
  })

  it('strips a workflow prefix so titles stay human', () => {
    expect(chatTitleFromMessage('[Workflow: NDA Review (id: abc)] Review this agreement')).toBe('Review this agreement')
  })

  it('truncates long first lines and falls back for empty content', () => {
    expect(chatTitleFromMessage('x'.repeat(200)).length).toBeLessThanOrEqual(80)
    expect(chatTitleFromMessage('   ')).toBe('New chat')
  })
})

describe('messagesFromPersisted', () => {
  it('rebuilds workflow chips and tool events from stored rows', () => {
    const messages = messagesFromPersisted([
      {
        id: 'u1',
        role: 'user',
        content: 'Review the lease',
        events: [{ workflow_attached: { id: 'wf-1', title: 'Lease Review' } }],
        created_at: '2026-07-15T00:00:00Z',
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is the review.',
        events: [
          { workflow_applied: { workflow_id: 'wf-1', title: 'Lease Review' } },
          { tool: 'read_workflow', tool_use_id: 't1', status: 'running' },
          { tool: 'read_workflow', tool_use_id: 't1', status: 'done' },
        ],
        created_at: '2026-07-15T00:00:05Z',
      },
    ])

    expect(messages[0].workflowAttached).toEqual({ id: 'wf-1', title: 'Lease Review' })
    expect(messages[1].workflowApplied).toEqual({ id: 'wf-1', title: 'Lease Review' })
    expect(messages[1].toolEvents).toHaveLength(1)
    expect(messages[1].toolEvents?.[0]).toMatchObject({ tool: 'read_workflow', toolUseId: 't1', status: 'done' })
  })
})
