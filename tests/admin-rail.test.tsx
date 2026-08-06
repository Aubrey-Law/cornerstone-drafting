// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = { current: '/admin/matters/m1' }

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  },
}))

import { ChatPanel } from '@/app/admin/components/ChatPanel'
import { splitHandoffBlocks } from '@/app/admin/components/ChatMessage'
import { railRecordForPath } from '@/components/rail/RailActivityPane'

const TRUST_BLOCK = [
  '=== TRUST DRAFTING SKILL INPUT ===',
  'Matter type: Individual',
  'Client full legal name: Margaret Whitfield',
  '=== END ===',
].join('\n')

beforeEach(() => {
  // jsdom has no scrollTo; the thread auto-scrolls on every message change.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
  pathname.current = '/admin/matters/m1'
  window.sessionStorage.clear()
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ turns: [] }), { status: 200 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('rail record scope', () => {
  it('maps matter, drafting and lead routes, and ignores the rest', () => {
    expect(railRecordForPath('/admin/matters/abc')).toEqual({ type: 'matter', id: 'abc' })
    expect(railRecordForPath('/admin/drafting/abc/design')).toEqual({ type: 'matter', id: 'abc' })
    expect(railRecordForPath('/admin/leads/lead-1')).toEqual({ type: 'lead', id: 'lead-1' })
    expect(railRecordForPath('/admin/crm/opportunities/lead-1')).toEqual({ type: 'lead', id: 'lead-1' })
    expect(railRecordForPath('/admin/leads/new')).toBeNull()
    expect(railRecordForPath('/admin/calendar')).toBeNull()
  })
})

describe('skill handoff blocks', () => {
  it('splits a fenced trust block out of the surrounding prose', () => {
    const segments = splitHandoffBlocks(`Here is the recap.\n\n\`\`\`\n${TRUST_BLOCK}\n\`\`\`\n\nLet me know.`)
    expect(segments.map(s => s.type)).toEqual(['text', 'handoff', 'text'])
    expect(segments[1]).toMatchObject({ type: 'handoff', kind: 'trust' })
    // The fence itself is consumed so no stray backticks reach the markdown renderer.
    expect(segments[0].content).not.toContain('```')
    expect(segments[2].content).not.toContain('```')
  })

  it('recognises the incapacity block and leaves plain messages untouched', () => {
    const incapacity = '=== INCAPACITY DRAFTING SKILL INPUT ===\nPrincipal: X\n=== END ==='
    expect(splitHandoffBlocks(incapacity)[0]).toMatchObject({ type: 'handoff', kind: 'incapacity' })
    expect(splitHandoffBlocks('Just a normal answer.')).toEqual([
      { type: 'text', content: 'Just a normal answer.' },
    ])
  })
})

describe('ChatPanel as a rail pane', () => {
  function renderPanel(props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
    return render(
      <ChatPanel
        open
        matterDisplayName="Whitfield Family Trust"
        assistantModelLabel="Claude Opus 4.8"
        {...props}
      />,
    )
  }

  it('shows the context strip, the switch-to-general escape hatch and the model notice', async () => {
    renderPanel()
    expect(await screen.findByText('Matter · Whitfield Family Trust')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch to general' })).toBeTruthy()
    expect(
      screen.getByText('Claude Opus 4.8 · Matter context loaded · answers are drafts, not filed advice'),
    ).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Switch to general' }))
    expect(screen.getByText('Firm')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Switch to general' })).toBeNull()
  })

  it('falls back to an error notice when no assistant model is configured', async () => {
    renderPanel({ assistantModelLabel: null })
    expect(
      await screen.findByText('No assistant model is configured for this workspace.'),
    ).toBeTruthy()
  })

  it('renders the empty state as an action list that sends the prompt on click', async () => {
    renderPanel()
    expect(await screen.findByText('What can I help you with?')).toBeTruthy()
    const action = screen.getByRole('button', { name: /Analyze MA estate tax exposure/ })

    await userEvent.click(action)

    await waitFor(() => {
      const chatCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .find(call => String(call[0]).includes('/api/admin/chat'))
      expect(chatCall).toBeTruthy()
      const body = JSON.parse(String((chatCall![1] as RequestInit).body))
      expect(body.context_type).toBe('matter')
      expect(body.messages.at(-1).content).toBe('Analyze MA estate tax exposure')
    })
  })

  it('loads lead context and sends the open lead id from a lead route', async () => {
    pathname.current = '/admin/leads/lead-1'
    renderPanel()
    expect(await screen.findByText('Lead · Lead context loaded')).toBeTruthy()
    const action = screen.getByRole('button', { name: /Summarize this client's situation/ })

    await userEvent.click(action)

    await waitFor(() => {
      const chatCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .find(call => String(call[0]).includes('/api/admin/chat'))
      expect(chatCall).toBeTruthy()
      const body = JSON.parse(String((chatCall![1] as RequestInit).body))
      expect(body.context_type).toBe('lead')
      expect(body.context_id).toBe('lead-1')
    })
  })

  it('isolates record turns when switching from a matter to a lead', async () => {
    const view = renderPanel()
    await screen.findByText('Matter · Whitfield Family Trust')
    await userEvent.click(screen.getByRole('button', { name: /Summarize contacts and fiduciary roles/ }))

    await waitFor(() => {
      expect(screen.getByText('Summarize contacts and fiduciary roles')).toBeTruthy()
    })

    pathname.current = '/admin/leads/lead-2'
    view.rerender(
      <ChatPanel
        open
        matterDisplayName="Whitfield Family Trust"
        assistantModelLabel="Claude Opus 4.8"
      />,
    )

    expect(await screen.findByText('Lead · Lead context loaded')).toBeTruthy()
    expect(screen.queryByText('Summarize contacts and fiduciary roles')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Summarize this client's situation/ }))

    await waitFor(() => {
      const chatCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter(call => String(call[0]).includes('/api/admin/chat'))
      const body = JSON.parse(String((chatCalls.at(-1)![1] as RequestInit).body))
      expect(body).toMatchObject({ context_type: 'lead', context_id: 'lead-2' })
      expect(body.messages).toEqual([
        { role: 'user', content: "Summarize this client's situation" },
      ])
    })
  })

  it('retains a lead thread when the assistant rail closes and reopens', async () => {
    pathname.current = '/admin/leads/lead-3'
    const view = renderPanel()
    await screen.findByText('Lead · Lead context loaded')
    await userEvent.click(screen.getByRole('button', { name: /Summarize this client's situation/ }))
    await waitFor(() => {
      expect(window.sessionStorage.getItem('cornerstone-admin-chat-messages:lead:lead-3')).toContain(
        "Summarize this client's situation",
      )
    })

    view.rerender(
      <ChatPanel
        open={false}
        matterDisplayName="Whitfield Family Trust"
        assistantModelLabel="Claude Opus 4.8"
      />,
    )
    view.rerender(
      <ChatPanel
        open
        matterDisplayName="Whitfield Family Trust"
        assistantModelLabel="Claude Opus 4.8"
      />,
    )

    expect(await screen.findByText("Summarize this client's situation")).toBeTruthy()
  })
})
