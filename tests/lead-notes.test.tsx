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
const meetings = [{ id: 'm1', title: 'Planning call', date: '2026-07-03T00:00:00Z', attendees: ['Jane', 'John'], body: 'Discussed the plan in detail.', source: 'manual', granolaNoteId: null, actorId: 'u1', createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-03T00:00:00Z' }]

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('lead notes', () => {
  it('renders internal notes newest first and expands meeting notes', async () => {
    const user = userEvent.setup()
    render(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={meetings} currentUser={{ id: 'u1', role: 'attorney' }} />)
    expect(screen.getByText('Internal only')).toBeTruthy()
    expect(screen.getByLabelText('Internal notes list').querySelectorAll('article')[0].textContent).toContain('Newest note')
    expect(screen.queryByText('Discussed the plan in detail.')).toBeNull()
    const toggle=screen.getByRole('button', { name: /Planning call/ });expect(toggle.getAttribute('aria-expanded')).toBe('false');await user.click(toggle);expect(toggle.getAttribute('aria-expanded')).toBe('true')
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

  it('keeps meeting notes date-sorted and exposes an accessible cancellable dialog', async () => {
    const older={...meetings[0],id:'m0',title:'Older call',date:'2026-06-01T00:00:00Z'}
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({meetingNote:older})} as Response)
    const user=userEvent.setup();render(<LeadNotesCard leadId="l1" initialNotes={[]} initialMeetingNotes={meetings} currentUser={{id:'u1',role:'admin'}}/>);await user.click(screen.getByRole('button',{name:'Add meeting note'}));const dialog=screen.getByRole('dialog',{name:'Add meeting note'});expect(dialog.getAttribute('aria-modal')).toBe('true');expect((screen.getByRole('button',{name:'Save meeting note'}) as HTMLButtonElement).disabled).toBe(true);await user.type(screen.getByLabelText('Meeting title'),'Older call');await user.type(screen.getByLabelText('Meeting date'),'2026-06-01');await user.type(screen.getByLabelText('Attendees'),'Jane');await user.type(screen.getByLabelText('Meeting notes'),'Older notes');await user.click(screen.getByRole('button',{name:'Save meeting note'}));expect(screen.getByLabelText('Meeting notes list').querySelectorAll('article')[1].textContent).toContain('Older call')
    await user.click(screen.getByRole('button',{name:'Add meeting note'}));await user.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('surfaces request errors, preserves input, and prevents duplicate submission', async () => {
    let release:(value:Response)=>void=()=>{};const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{release=resolve}));const user=userEvent.setup();render(<LeadNotesCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{id:'u1',role:'attorney'}}/>);await user.type(screen.getByLabelText('New note'),'Keep me');const add=screen.getByRole('button',{name:'Add note'}) as HTMLButtonElement;await user.click(add);expect(add.disabled).toBe(true);await user.click(add);expect(fetchMock).toHaveBeenCalledTimes(1);release({ok:false,json:async()=>({error:'Audit failed'})} as Response);expect((await screen.findByRole('alert')).textContent).toContain('Audit failed');expect((screen.getByLabelText('New note') as HTMLInputElement).value).toBe('Keep me')
  })

  it('only shows delete to the author or an admin', () => {
    const { rerender } = render(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'attorney' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(0);expect(screen.queryAllByRole('button', { name: 'Edit note' })).toHaveLength(0)
    rerender(<LeadNotesCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'admin' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(2)
  })
})
