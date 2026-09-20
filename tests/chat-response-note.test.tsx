// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pathname = { current: '/admin/matters/m1' }

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
}))

import { ChatPanel } from '@/app/admin/components/ChatPanel'
import { ChatMessage } from '@/app/admin/components/ChatMessage'
import { chatResponseNoteText } from '@/app/admin/components/chatExport'

const ANSWER = 'The trust is funded except for the brokerage account.'

function assistantMessage(content = ANSWER) {
  return {
    id: 'a1',
    role: 'assistant' as const,
    content,
    timestamp: '2026-09-18T15:04:00Z',
    contextSnapshot: { type: 'matter', id: 'm1' },
  }
}

/** The thread the panel reads back: one question, one answer. */
function historyResponse() {
  return new Response(
    JSON.stringify({
      turns: [
        { role: 'user', content: 'Where does funding stand?', createdAt: '2026-09-18T15:03:00Z' },
        { role: 'assistant', content: ANSWER, createdAt: '2026-09-18T15:04:00Z' },
      ],
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
  pathname.current = '/admin/matters/m1'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the note text a single response produces', () => {
  it('keeps the answer’s markdown and says the assistant wrote it', () => {
    const note = chatResponseNoteText(assistantMessage('- Fund the brokerage account\n- Re-title the deed'))
    const [heading, ...body] = note.split('\n\n')
    expect(heading).toMatch(/^\*\*.+\*\* · /)
    expect(body.join('\n\n')).toBe('- Fund the brokerage account\n- Re-title the deed')
  })

  it('has nothing to save for an empty answer', () => {
    expect(chatResponseNoteText(assistantMessage('   '))).toBe('')
  })
})

describe('an assistant response can be filed as a note on its own', () => {
  it('offers the action on an answer, not on the attorney’s own message', () => {
    render(<ChatMessage message={assistantMessage()} onSaveAsNote={async () => true} />)
    expect(screen.getByRole('button', { name: 'Save this response to the matter notes' })).toBeTruthy()

    cleanup()
    render(
      <ChatMessage
        message={{ ...assistantMessage(), role: 'user' }}
        onSaveAsNote={async () => true}
      />,
    )
    expect(screen.queryByRole('button', { name: /Save this response/ })).toBeNull()
  })

  it('leaves the action out when the context cannot take notes', () => {
    render(<ChatMessage message={assistantMessage()} />)
    expect(screen.queryByRole('button', { name: /Save this response/ })).toBeNull()
  })

  it('confirms the save, then returns to the idle label', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<ChatMessage message={assistantMessage()} onSaveAsNote={async () => true} />)

      await user.click(screen.getByRole('button', { name: 'Save this response to the matter notes' }))

      expect(await screen.findByText('Saved to notes')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(4000)
      await waitFor(() => expect(screen.getByText('Save as note')).toBeTruthy())
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops back to the idle label when the save failed', async () => {
    render(<ChatMessage message={assistantMessage()} onSaveAsNote={async () => false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save this response to the matter notes' }))

    await waitFor(() => expect(screen.getByText('Save as note')).toBeTruthy())
    expect(screen.queryByText('Saved to notes')).toBeNull()
  })
})

describe('saving one response from the matter rail', () => {
  it('writes that answer alone, under the chosen note type', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes('/api/admin/chat/save-note')) {
        return new Response(JSON.stringify({ note: { id: 'n1' } }), { status: 201 })
      }
      return historyResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel open matterDisplayName="Whitfield Family Trust" assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Client comm.' }))
    await userEvent.click(screen.getByRole('button', { name: /Save this response/ }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes('/api/admin/chat/save-note'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call![1] as RequestInit).body))
      expect(body).toMatchObject({ context_type: 'matter', context_id: 'm1', note_type: 'client_comm' })
      expect(body.content).toContain(ANSWER)
      // The one answer, not the question that produced it.
      expect(body.content).not.toContain('Where does funding stand?')
    })

    expect(await screen.findByText(/This response is now part of the matter file/)).toBeTruthy()
  })

  it('reports a failed save instead of claiming the note was filed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/admin/chat/save-note')) {
        return new Response(JSON.stringify({ error: 'Matter not found' }), { status: 404 })
      }
      return historyResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel open matterDisplayName="Whitfield Family Trust" assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Save this response/ }))

    expect(await screen.findByText('Matter not found')).toBeTruthy()
    expect(screen.queryByText(/is now part of the matter file/)).toBeNull()
  })

  it('keeps the action off the general thread, which has no record to file on', async () => {
    pathname.current = '/admin/calendar'
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse()))

    render(<ChatPanel open assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    expect(screen.queryByRole('button', { name: /Save this response/ })).toBeNull()
  })
})

describe('saving one response from a lead thread', () => {
  it('files it on the lead, with no note type to choose', async () => {
    pathname.current = '/admin/leads/lead-1'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes('/api/admin/chat/save-note')) {
        return new Response(JSON.stringify({ note: { id: 'n1' } }), { status: 201 })
      }
      return historyResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel open assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()
    // The Internal / Client comm. toggle belongs to the matter file.
    expect(screen.queryByRole('button', { name: 'Client comm.' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Save this response to the lead notes' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes('/api/admin/chat/save-note'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call![1] as RequestInit).body))
      expect(body).toMatchObject({ context_type: 'lead', context_id: 'lead-1' })
      expect(body).not.toHaveProperty('note_type')
      expect(body.content).toContain(ANSWER)
      expect(body.content).not.toContain('Where does funding stand?')
    })

    expect(await screen.findByText('Saved to lead notes')).toBeTruthy()
    expect(screen.getByText(/This response is now part of the lead/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('href')).toBe('/admin/leads/lead-1?tab=notes')
  })

  it('reports a failed save instead of claiming the note was filed', async () => {
    pathname.current = '/admin/leads/lead-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/admin/chat/save-note')) {
        return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 })
      }
      return historyResponse()
    }))

    render(<ChatPanel open assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Save this response/ }))

    expect(await screen.findByText('Lead not found')).toBeTruthy()
    expect(screen.queryByText(/is now part of the/)).toBeNull()
  })
})

describe('saving the whole conversation', () => {
  function saveNoteFetch() {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes('/api/admin/chat/save-note')) {
        return new Response(JSON.stringify({ note: { id: 'n1' } }), { status: 201 })
      }
      return historyResponse()
    })
  }

  it('files the thread on a lead, both turns and no note type', async () => {
    pathname.current = '/admin/leads/lead-1'
    const fetchMock = saveNoteFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel open assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Save to lead notes' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes('/api/admin/chat/save-note'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call![1] as RequestInit).body))
      expect(body).toMatchObject({ context_type: 'lead', context_id: 'lead-1' })
      expect(body).not.toHaveProperty('note_type')
      // The whole thread, question included — that is what distinguishes it
      // from the per-response save.
      expect(body.content).toContain('Where does funding stand?')
      expect(body.content).toContain(ANSWER)
    })

    expect(await screen.findByText('Saved to lead notes')).toBeTruthy()
    expect(screen.getByText(/This conversation is now part of the lead/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('href')).toBe('/admin/leads/lead-1?tab=notes')
  })

  it('still files the thread on a matter, under the chosen note type', async () => {
    const fetchMock = saveNoteFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel open matterDisplayName="Whitfield Family Trust" assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Client comm.' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to matter notes' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes('/api/admin/chat/save-note'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call![1] as RequestInit).body))
      expect(body).toMatchObject({ context_type: 'matter', context_id: 'm1', note_type: 'client_comm' })
      expect(body.content).toContain('Where does funding stand?')
    })

    expect(await screen.findByText('Saved to matter notes · Client comm.')).toBeTruthy()
  })

  it('offers no save on the general thread, which has no record', async () => {
    pathname.current = '/admin/calendar'
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse()))

    render(<ChatPanel open assistantModelLabel="Claude Opus 4.8" />)
    expect(await screen.findByText(ANSWER)).toBeTruthy()

    expect(screen.queryByRole('button', { name: /Save to .* notes/ })).toBeNull()
  })
})
