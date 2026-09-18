// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }))

import { ChatMessage } from '@/app/admin/components/ChatMessage'
import { toolEventFrom } from '@/app/admin/components/chatStream'

/**
 * Read-only tools rendered nothing. The attorney saw "Thinking…" and then an
 * answer, with no sign the record had been pulled — and no way to tell when it
 * had not been.
 */
function message(event: ReturnType<typeof toolEventFrom>, content = 'Here is what I found.') {
  return { id: 'm1', role: 'assistant' as const, content, timestamp: '2026-09-17T12:00:00Z', toolEvents: [event] }
}

afterEach(() => cleanup())

describe('the attorney can see the assistant read the record', () => {
  it('names the matter and sections a record read covered', () => {
    render(<ChatMessage message={message(toolEventFrom({
      tool: 'read_matter_record', tool_use_id: 't1', status: 'done',
      result: { matter_id: 'm1', matter_label: 'Chen Family Trust · #24-018', sections: ['overview', 'tasks'] },
    }))} />)
    expect(screen.getByText(/Read matter record/)).toBeTruthy()
    expect(screen.getByText(/Chen Family Trust/)).toBeTruthy()
    expect(screen.getByText(/overview, tasks/)).toBeTruthy()
  })

  it('shows a search as in progress while it runs', () => {
    render(<ChatMessage message={message(toolEventFrom({ tool: 'find_matter', tool_use_id: 't1', status: 'running' }), '')} />)
    expect(screen.getByText(/Searching records/)).toBeTruthy()
  })

  it('reports how many records a search matched', () => {
    render(<ChatMessage message={message(toolEventFrom({
      tool: 'find_matter', tool_use_id: 't1', status: 'done', result: { query: 'chen', match_count: 2 },
    }))} />)
    expect(screen.getByText(/2 matches for “chen”/)).toBeTruthy()
  })

  it('says when a read failed instead of hiding it', () => {
    render(<ChatMessage message={message(toolEventFrom({
      tool: 'read_document_text', tool_use_id: 't1', status: 'error', error: 'Document not found',
    }))} />)
    expect(screen.getByText(/Document not found/)).toBeTruthy()
  })
})
