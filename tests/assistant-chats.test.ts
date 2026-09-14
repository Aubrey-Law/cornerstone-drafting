import { describe, expect, it } from 'vitest'

import { chatTitleFromMessage } from '@/lib/assistantChats'
import { messagesFromPersisted, toolEventFrom } from '@/app/admin/assistant/components/useAssistantStream'

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

/**
 * The live-stream path and the replay path each had their own mapping and had
 * drifted: a task card only appeared after a reload, and the proposal cards the
 * gated write tools emit never rendered on the assistant page at all.
 */
describe('one tool-event mapping serves the live stream and the replay', () => {
  const result = {
    task_id: 'task-1',
    title: 'Call the client',
    proposal: [{ id: 't1', title: 'Call the client', rationale: '', kind: 'create_task', payload: {} }],
    signedUrl: 'https://example.test/doc',
    totalClaim: 1234,
  }

  it('carries task, proposal, signed-url and claim fields', () => {
    const live = toolEventFrom({ tool: 'create_task', tool_use_id: 't1', status: 'done', result })

    expect(live.taskId).toBe('task-1')
    expect(live.taskTitle).toBe('Call the client')
    expect(live.proposal).toHaveLength(1)
    expect(live.signedUrl).toBe('https://example.test/doc')
    expect(live.totalClaim).toBe(1234)
  })

  it('rebuilds the same chip from a persisted row', () => {
    const [message] = messagesFromPersisted([{
      id: 'm1',
      role: 'assistant',
      content: '',
      created_at: '2026-01-01T00:00:00Z',
      events: [{ tool: 'create_task', tool_use_id: 't1', status: 'done', result }],
    }])
    const replayed = message!.toolEvents?.[0]

    expect(replayed).toEqual(toolEventFrom({ tool: 'create_task', tool_use_id: 't1', status: 'done', result }))
  })
})
