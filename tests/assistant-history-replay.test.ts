import { describe, expect, it } from 'vitest'

import { replayMessagesForModel, TOOL_RESULT_REPLAY_CHARS } from '@/lib/assistantChats'

const at = (i: number) => `2026-09-17T00:00:${String(i).padStart(2, '0')}Z`
const row = (i: number, role: 'user' | 'assistant', content: string, events: Record<string, unknown>[] = []) =>
  ({ id: `m${i}`, chat_id: 'c1', role, content, events, created_at: at(i) })

/**
 * Persisted history used to be text only. The model forgot every record it
 * had read by the next turn and either re-read it or guessed, and a reply that
 * was all tool activity replayed as the literal string "[Tool activity — see
 * events]". The rounds are stored now and rebuilt here.
 */
describe('replaying a saved thread to the model', () => {
  it('rebuilds tool rounds as assistant tool_use blocks followed by user tool_result blocks', () => {
    const toolUse = { type: 'tool_use', id: 't1', name: 'read_matter_record', input: { sections: ['overview'] } }
    const messages = replayMessagesForModel([
      row(1, 'user', 'What stage are the Chens at?'),
      row(2, 'assistant', 'Design.', [
        { tool: 'read_matter_record', tool_use_id: 't1', status: 'done' },
        { tool_round: { assistant_content: [toolUse], tool_results: [{ type: 'tool_result', tool_use_id: 't1', content: '{"stage":"design"}' }] } },
      ]),
    ])

    expect(messages).toEqual([
      { role: 'user', content: 'What stage are the Chens at?' },
      { role: 'assistant', content: [toolUse] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"stage":"design"}' }] },
      { role: 'assistant', content: 'Design.' },
    ])
  })

  it('starts on a user turn even when the window was cut on an assistant row', () => {
    const messages = replayMessagesForModel([
      row(1, 'assistant', 'earlier answer'),
      row(2, 'user', 'next question'),
      row(3, 'assistant', 'answer'),
    ])
    expect(messages[0]).toEqual({ role: 'user', content: 'next question' })
  })

  it('never replays the old tool-activity placeholder as something the assistant said', () => {
    const messages = replayMessagesForModel([
      row(1, 'user', 'q'),
      row(2, 'assistant', '[Tool activity — see events]', [{ tool: 'find_matter', tool_use_id: 't1', status: 'done' }]),
      row(3, 'user', 'q2'),
    ])
    expect(JSON.stringify(messages)).not.toContain('[Tool activity')
  })

  it('closes a tool-only reply with an assistant turn so the thread still alternates', () => {
    const messages = replayMessagesForModel([
      row(1, 'user', 'q'),
      row(2, 'assistant', '', [
        { tool_round: { assistant_content: [{ type: 'tool_use', id: 't1', name: 'find_matter', input: {} }], tool_results: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] } },
      ]),
      row(3, 'user', 'q2'),
    ])
    const roles = messages.map(message => message.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })

  it('truncates an oversized stored tool result rather than replaying it whole', () => {
    const big = 'x'.repeat(TOOL_RESULT_REPLAY_CHARS * 3)
    const messages = replayMessagesForModel([
      row(1, 'user', 'q'),
      row(2, 'assistant', 'a', [
        { tool_round: { assistant_content: [{ type: 'tool_use', id: 't1', name: 'read_document_text', input: {} }], tool_results: [{ type: 'tool_result', tool_use_id: 't1', content: big }] } },
      ]),
    ])
    const replayed = (messages[2]!.content as Array<{ content: string }>)[0]!.content
    expect(replayed.length).toBeLessThan(big.length)
    expect(replayed).toContain('truncated')
  })
})
