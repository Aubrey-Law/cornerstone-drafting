// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

const { openExternalPhone } = vi.hoisted(() => ({ openExternalPhone: vi.fn() }))
vi.mock('@/lib/clientPhone', () => ({ openExternalPhone }))
import { LeadTimelineCard } from '@/components/leads/LeadTimelineCard'

const notes = [
  { id: 'n2', body: 'Newest note', noteType: 'internal' as const, actorId: 'u1', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' },
  { id: 'n1', body: 'Older note', noteType: 'internal' as const, actorId: 'u2', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' },
]
const meetings = [{ id: 'm1', title: 'Planning call', date: '2026-07-03T00:00:00Z', attendees: ['Jane', 'John'], body: 'Discussed the plan in detail.', source: 'manual', granolaNoteId: null, actorId: 'u1', createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-03T00:00:00Z' }]

Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.releasePointerCapture = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('lead notes', () => {
  it('renders one combined newest-first timeline and expands meeting notes', async () => {
    const user = userEvent.setup()
    render(<LeadTimelineCard
      leadId="l1"
      initialNotes={notes}
      initialMeetingNotes={meetings}
      initialActivity={[{ id: 'a1', event_type: 'status_changed', title: 'Status changed', detail: null, actor_id: null, created_at: '2026-07-04T00:00:00Z' }]}
      currentUser={{ id: 'u1', role: 'attorney' }}
    />)
    expect(screen.getByText('Internal only')).toBeTruthy()
    expect([...screen.getByLabelText('Lead timeline').querySelectorAll('article')].map(row => row.textContent)).toEqual([
      expect.stringContaining('Status changed'),
      expect.stringContaining('Planning call'),
      expect.stringContaining('Newest note'),
      expect.stringContaining('Older note'),
    ])
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
    render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} />)
    await user.type(screen.getByLabelText('New note'), 'Fresh note'); await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.click(screen.getByRole('button', { name: 'Edit note' })); const edit = screen.getByLabelText('Edit note body'); await user.clear(edit); await user.type(edit, 'Edited note'); await user.click(screen.getByRole('button', { name: 'Save note' }))
    // Deleting now asks first. The trash icon opens the app's own dialog
    // instead of firing a DELETE, so the confirm step is part of the path.
    await user.click(screen.getByRole('button', { name: 'Delete note' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete note' }))
    expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'PATCH', 'DELETE'])
  })

  it('does not delete a note when the confirmation is dismissed', async () => {
    // The point of the dialog: backing out must leave the note alone.
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'admin' }} />)
    await user.click(screen.getAllByRole('button', { name: 'Delete note' })[0])
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a committed note successful and warns separately when activity refresh fails', async () => {
    const onActivityChange = vi.fn().mockRejectedValue(new Error('activity refresh failed'))
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        note: {
          id: 'n3',
          body: 'Fresh note',
          actorId: 'u1',
          createdAt: '2026-07-25T12:00:00Z',
          updatedAt: '2026-07-25T12:00:00Z',
        },
      }),
    } as Response)
    render(
      <LeadTimelineCard
        leadId="l1"
        initialNotes={[]}
        initialMeetingNotes={[]}
        currentUser={{ id: 'u1', role: 'attorney' }}
        actorNames={{ u1: 'Alice Attorney' }}
        onActivityChange={onActivityChange}
      />,
    )

    await user.type(screen.getByLabelText('New note'), 'Fresh note')
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    expect(await screen.findByText('Fresh note')).toBeTruthy()
    expect(screen.getByText(/Alice Attorney ·/)).toBeTruthy()
    expect((screen.getByLabelText('New note') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('activity refresh failed')
    await waitFor(() => {
      expect(screen.getByText('Timeline refresh unavailable: activity refresh failed')).toBeTruthy()
    })
  })

  it('creates a manual meeting note', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ meetingNote: meetings[0] }) } as Response)
    const user = userEvent.setup(); render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'admin' }} />)
    await user.click(screen.getByRole('button', { name: 'Add meeting note' }))
    await user.type(screen.getByLabelText('Meeting title'), 'Planning call'); await user.type(screen.getByLabelText('Meeting date'), '2026-07-03'); await user.type(screen.getByLabelText('Attendees'), 'Jane, John'); await user.type(screen.getByLabelText('Meeting notes'), 'Discussed the plan in detail.'); await user.click(screen.getByRole('button', { name: 'Save meeting note' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1/meeting-notes', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps meeting notes date-sorted and exposes an accessible cancellable dialog', async () => {
    const older={...meetings[0],id:'m0',title:'Older call',date:'2026-06-01T00:00:00Z'}
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({meetingNote:older})} as Response)
    const user=userEvent.setup();render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={meetings} currentUser={{id:'u1',role:'admin'}}/>);await user.click(screen.getByRole('button',{name:'Add meeting note'}));const dialog=screen.getByRole('dialog',{name:'Add meeting note'});expect(dialog.getAttribute('aria-modal')).toBe('true');expect((screen.getByRole('button',{name:'Save meeting note'}) as HTMLButtonElement).disabled).toBe(true);await user.type(screen.getByLabelText('Meeting title'),'Older call');await user.type(screen.getByLabelText('Meeting date'),'2026-06-01');await user.type(screen.getByLabelText('Attendees'),'Jane');await user.type(screen.getByLabelText('Meeting notes'),'Older notes');await user.click(screen.getByRole('button',{name:'Save meeting note'}));expect(screen.getByLabelText('Lead timeline').querySelectorAll('article')[1].textContent).toContain('Older call')
    await user.click(screen.getByRole('button',{name:'Add meeting note'}));await user.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('surfaces request errors, preserves input, and prevents duplicate submission', async () => {
    let release:(value:Response)=>void=()=>{};const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{release=resolve}));const user=userEvent.setup();render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{id:'u1',role:'attorney'}}/>);await user.type(screen.getByLabelText('New note'),'Keep me');const add=screen.getByRole('button',{name:'Add note'}) as HTMLButtonElement;await user.click(add);expect(add.disabled).toBe(true);await user.click(add);expect(fetchMock).toHaveBeenCalledTimes(1);release({ok:false,json:async()=>({error:'Audit failed'})} as Response);expect((await screen.findByRole('alert')).textContent).toContain('Audit failed');expect((screen.getByLabelText('New note') as HTMLInputElement).value).toBe('Keep me')
  })

  it('files a note under the type the picker names, and shows it in the timeline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ note: { id: 'n3', body: 'Called the client', noteType: 'client_comm', actorId: 'u1', createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z' } }),
    } as Response)
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} />)

    await user.type(screen.getByLabelText('New note'), 'Called the client')
    await user.click(within(screen.getByRole('group', { name: 'Note type' })).getByRole('button', { name: 'Client comm.' }))
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'Called the client', noteType: 'client_comm' })
    expect(await screen.findByText('Client communication')).toBeTruthy()
    // The picker returns to internal, so the next note is not swept along.
    expect(within(screen.getByRole('group', { name: 'Note type' })).getByRole('button', { name: 'Internal' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reclassifies a note from the edit row', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ note: { ...notes[0], noteType: 'client_comm' } }),
    } as Response)
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" initialNotes={[notes[0]]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} />)

    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    const picker = screen.getByRole('group', { name: 'Note type when saving' })
    // The picker opens on the note's own type, not on a default.
    expect(within(picker).getByRole('button', { name: 'Internal' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(picker).getByRole('button', { name: 'Client comm.' }))
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/admin/leads/l1/notes/n2')
    expect(JSON.parse(String(init?.body))).toEqual({ body: 'Newest note', noteType: 'client_comm' })
    expect(await screen.findByText('Client communication')).toBeTruthy()
  })

  it('only shows delete to the author or an admin', () => {
    const { rerender } = render(<LeadTimelineCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'attorney' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(0);expect(screen.queryAllByRole('button', { name: 'Edit note' })).toHaveLength(0)
    rerender(<LeadTimelineCard leadId="l1" initialNotes={notes} initialMeetingNotes={[]} currentUser={{ id: 'other', role: 'admin' }} />)
    expect(screen.queryAllByRole('button', { name: 'Delete note' })).toHaveLength(2)
  })

  it('filters timeline kinds', async () => {
    const user = userEvent.setup()
    render(<LeadTimelineCard
      leadId="l1"
      initialNotes={notes}
      initialMeetingNotes={meetings}
      initialActivity={[{ id: 'a1', event_type: 'status_changed', title: 'Status changed', detail: null, actor_id: null, created_at: '2026-07-04T00:00:00Z' }]}
      currentUser={{ id: 'u1', role: 'attorney' }}
    />)

    const logCall = screen.getByRole('button', { name: 'Log call' }) as HTMLButtonElement
    expect(logCall.disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('Status changed')).toBeNull()
    expect(screen.getByText('Newest note')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'System' }))
    expect(screen.getByText('Status changed')).toBeTruthy()
    expect(screen.queryByText('Newest note')).toBeNull()
  })

  it('renders a matching note activity echo exactly once', () => {
    render(<LeadTimelineCard
      leadId="l1"
      initialNotes={[notes[0]]}
      initialMeetingNotes={[]}
      initialActivity={[{ id: 'echo', event_type: 'note_added', title: 'Note added', detail: notes[0].body, actor_id: 'u1', created_at: '2026-07-02T00:00:04Z' }]}
      currentUser={{ id: 'u1', role: 'attorney' }}
    />)

    expect(screen.getAllByText('Newest note')).toHaveLength(1)
    expect(screen.queryByText('Note added')).toBeNull()
  })

  it('opens call outcome logging without launching the external calling application', async () => {
    openExternalPhone.mockClear()
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" leadPhone="+16175551212" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} />)
    await user.click(screen.getByRole('button', { name: 'Log call' }))
    expect(screen.getByRole('dialog', { name: 'Log call' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Call outcome' })).toBeTruthy()
    expect(openExternalPhone).not.toHaveBeenCalled()
  })

  it('logs an unsuccessful attempt even when the stored phone number is malformed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ activity: { id: 'call-1', created_at: '2026-07-25T12:00:00Z' } }) } as Response)
    const onCommittedTouch = vi.fn()
    const onActivityChange = vi.fn()
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" leadPhone="unknown" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} onCommittedTouch={onCommittedTouch} onActivityChange={onActivityChange} />)
    await user.click(screen.getByRole('button', { name: 'Log call' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Call outcome' }), 'wrong_number')
    await user.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(onActivityChange).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ eventType: 'call_logged', outcome: 'wrong_number' })
    expect(onCommittedTouch).not.toHaveBeenCalled()
  })

  it('keeps failed call logging open and does not report contact without persistence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Call could not be saved' }) } as Response)
    const onCommittedTouch = vi.fn()
    const onActivityChange = vi.fn()
    const user = userEvent.setup()
    render(<LeadTimelineCard leadId="l1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'u1', role: 'attorney' }} onCommittedTouch={onCommittedTouch} onActivityChange={onActivityChange} />)
    await user.click(screen.getByRole('button', { name: 'Log call' }))
    await user.click(screen.getByRole('button', { name: 'Save call' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Call could not be saved')
    expect(screen.getByRole('dialog', { name: 'Log call' })).toBeTruthy()
    expect(onCommittedTouch).not.toHaveBeenCalled()
    expect(onActivityChange).not.toHaveBeenCalled()
  })

})
