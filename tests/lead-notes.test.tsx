// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

import { LeadNotesCard } from '@/components/leads/LeadNotesCard'

const notes = [
  { id: 'n2', body: 'Newest note', actorId: 'u1', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' },
  { id: 'n1', body: 'Older note', actorId: 'u2', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' },
]
const meetings = [{ id: 'm1', title: 'Planning call', meetingDate: '2026-07-03T00:00:00Z', attendees: ['Jane', 'John'], body: 'Discussed the plan in detail.', source: 'manual', granolaNoteId: null, actorId: 'u1', createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-03T00:00:00Z' }]

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('lead notes', () => {
  it('renders internal notes newest first and expands meeting notes', async () => {
    const user = userEvent.setup()
    const { container } = render(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={meetings} currentUser={{ id: 'u1', role: 'attorney' }} />)
    expect(screen.getByText('Internal only')).toBeTruthy()
    expect((container.textContent ?? '').indexOf('Newest note')).toBeLessThan((container.textContent ?? '').indexOf('Older note'))
    expect(screen.queryByText('Discussed the plan in detail.')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Planning call/ }))
    expect(screen.getByText('Discussed the plan in detail.')).toBeTruthy()
  })

  it('creates, edits, and deletes an ordinary note', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ note: { ...notes[0], id: 'n3', body: 'Fresh note' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ note: { ...notes[0], body: 'Edited note' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
    const user = userEvent.setup()
    render(<LeadNotesCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} />)
    await user.type(screen.getByLabelText('New note'), 'Fresh note'); await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.click(screen.getByRole('button', { name: 'Edit note' })); const edit = screen.getByLabelText('Edit note body'); await user.clear(edit); await user.type(edit, 'Edited note'); await user.click(screen.getByRole('button', { name: 'Save note' }))
    await user.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'PATCH', 'DELETE'])
  })

  it('creates a manual meeting note', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ meetingNote: meetings[0] }) } as Response)
    const user = userEvent.setup(); render(<LeadNotesCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'admin' }} />)
    await user.click(screen.getByRole('button', { name: 'Add meeting note' }))
    await user.type(screen.getByLabelText('Meeting title'), 'Planning call'); await user.type(screen.getByLabelText('Meeting date'), '2026-07-03'); await user.type(screen.getByLabelText('Attendees'), 'Jane, John'); await user.type(screen.getByLabelText('Meeting notes'), 'Discussed the plan in detail.'); await user.click(screen.getByRole('button', { name: 'Save meeting note' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1/meeting-notes', expect.objectContaining({ method: 'POST' }))
  })

  it('only shows delete to the author or an admin', () => {
    const { rerender } = render(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'attorney' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(0)
    rerender(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'admin' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(2)
  })
})
