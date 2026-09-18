// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))

import { MatterAssistantPanel } from '@/components/drafting/MatterAssistantPanel'

function sse(frames: Array<Record<string, unknown> | '[DONE]'>) {
  return frames.map(frame => `data: ${frame === '[DONE]' ? '[DONE]' : JSON.stringify(frame)}\n\n`).join('')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * The panel spoke its own SSE dialect and rendered tool use as a line of
 * italic text. It now reads the shared stream and draws the shared cards, so
 * a record read or a proposal looks the same here as on the Assistant page.
 */
describe('the Review-step assistant panel', () => {
  it('shows the saved thread, then streams a reply with its tool activity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return new Response(sse([
          { tool: 'read_matter_record', tool_use_id: 't1', status: 'running' },
          { tool: 'read_matter_record', tool_use_id: 't1', status: 'done', result: { matter_label: 'Chen Trust', sections: ['people'] } },
          { text: 'The successor trustee is ' },
          { text: 'Dana Chen in both drafts.' },
          '[DONE]',
        ]), { headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/assistant')) {
        return new Response(JSON.stringify({ turns: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const user = userEvent.setup()

    render(<MatterAssistantPanel matterId="m1" documentIds={['d1']} />)
    await waitFor(() => expect(screen.getByText('Earlier answer')).toBeTruthy())

    await user.type(screen.getByPlaceholderText(/ask the drafting assistant/i), 'Who is the successor trustee?')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByText(/Dana Chen in both drafts/)).toBeTruthy())
    expect(screen.getByText(/Read matter record/)).toBeTruthy()
    expect(screen.getByText(/Chen Trust/)).toBeTruthy()

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(postCall[1]!.body))).toEqual({ message: 'Who is the successor trustee?', documentIds: ['d1'] })
  })

  it('shows the error on the failed turn and offers a retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        return new Response(sse([{ error: 'Chat unavailable - try again in a moment.' }]), { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify({ turns: [] }), { headers: { 'Content-Type': 'application/json' } })
    })
    const user = userEvent.setup()

    render(<MatterAssistantPanel matterId="m1" />)
    await waitFor(() => expect(screen.getByPlaceholderText(/ask the drafting assistant/i)).toBeTruthy())
    await user.type(screen.getByPlaceholderText(/ask the drafting assistant/i), 'hello{Enter}')

    await waitFor(() => expect(screen.getByText(/Chat unavailable/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})
