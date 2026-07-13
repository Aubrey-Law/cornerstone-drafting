// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdmin, fetchGranolaNote, isGranolaNoteId, from } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  fetchGranolaNote: vi.fn(),
  isGranolaNoteId: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/granola', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/granola')>()),
  fetchGranolaNote,
  isGranolaNoteId,
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from }) }))

import { AddMeetingNotesDialog } from '@/components/meeting-notes/AddMeetingNotesDialog'
import { LeadNotesCard } from '@/components/leads/LeadNotesCard'
import { POST } from '@/app/api/admin/leads/[id]/meeting-notes/granola/route'

const granolaDoc = {
  id: 'not_abcdefghijklmn',
  title: 'Estate planning consult',
  meetingDate: '2026-07-10',
  notesMarkdown: 'Discussed a revocable trust.',
  attendees: ['Jane Client <jane@example.com>'],
  sourceUrl: 'https://notes.granola.ai/note',
}
const row = {
  id: 'meeting-1', lead_id: 'lead-1', title: granolaDoc.title,
  meeting_date: '2026-07-10T00:00:00Z', attendees: granolaDoc.attendees,
  body: granolaDoc.notesMarkdown, source: 'granola', granola_note_id: granolaDoc.id,
  actor_id: 'user-1', created_at: '2026-07-10T12:00:00Z', updated_at: '2026-07-10T12:00:00Z',
}

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ err: null, userId: 'user-1' })
  isGranolaNoteId.mockReturnValue(true)
  fetchGranolaNote.mockResolvedValue(granolaDoc)
})

describe('lead Granola notes', () => {
  it('opens from Lead Notes, fetches a Granola note, and persists it to the lead target', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ notes: [{ id: granolaDoc.id, title: granolaDoc.title, createdAt: '2026-07-10T12:00:00Z' }] }))
      .mockResolvedValueOnce(response({ title: granolaDoc.title, meetingDate: granolaDoc.meetingDate, content: granolaDoc.notesMarkdown, attendees: granolaDoc.attendees, sourceUrl: granolaDoc.sourceUrl }))
      .mockResolvedValueOnce(response({ meetingNote: row, imported: true }))
    const user = userEvent.setup()
    render(<LeadNotesCard leadId="lead-1" initialNotes={[]} initialMeetingNotes={[]} currentUser={{ id: 'user-1', role: 'attorney' }} />)

    await user.click(screen.getByRole('button', { name: 'Import from Granola' }))
    await user.click(await screen.findByRole('button', { name: new RegExp(granolaDoc.title) }))
    expect(await screen.findByDisplayValue(granolaDoc.notesMarkdown)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save notes' }))

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/leads/lead-1/meeting-notes/granola', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }),
    }))
    expect(await screen.findByRole('button', { name: /Estate planning consult/ })).toBeTruthy()
  })

  it('retains the selected note and the open dialog when lead persistence fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ notes: [{ id: granolaDoc.id, title: granolaDoc.title, createdAt: '2026-07-10T12:00:00Z' }] }))
      .mockResolvedValueOnce(response({ title: granolaDoc.title, meetingDate: granolaDoc.meetingDate, content: granolaDoc.notesMarkdown, attendees: granolaDoc.attendees }))
      .mockResolvedValueOnce(response({ error: 'Lead import failed' }, false, 500))
    const user = userEvent.setup()
    render(<AddMeetingNotesDialog open onOpenChange={vi.fn()} target={{ kind: 'lead', id: 'lead-1' }} onImported={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: new RegExp(granolaDoc.title) }))
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    await waitFor(() => expect(screen.getByDisplayValue(granolaDoc.notesMarkdown)).toBeTruthy())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('keeps the existing matter endpoint and payload unchanged', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ notes: [{ id: granolaDoc.id, title: granolaDoc.title, createdAt: '2026-07-10T12:00:00Z' }] }))
      .mockResolvedValueOnce(response({ title: granolaDoc.title, meetingDate: granolaDoc.meetingDate, content: granolaDoc.notesMarkdown, sourceUrl: granolaDoc.sourceUrl }))
      .mockResolvedValueOnce(response({ document: { id: 'doc-1' } }))
    const user = userEvent.setup()
    render(<AddMeetingNotesDialog open onOpenChange={vi.fn()} target={{ kind: 'matter', id: 'matter-1' }} onImported={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: new RegExp(granolaDoc.title) }))
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/meeting-notes', expect.objectContaining({ method: 'POST' }))
    const payload = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(payload).toMatchObject({ matterId: 'matter-1', title: granolaDoc.title, content: granolaDoc.notesMarkdown, source: 'granola' })
  })

  it('validates, imports once, logs one activity, and returns the existing row on duplicate import', async () => {
    const inserted = { select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: row, error: null }) })) }
    const activityInsert = vi.fn().mockResolvedValue({ error: null })
    from.mockImplementation((table: string) => table === 'lead_meeting_notes'
      ? { insert: vi.fn(() => inserted) }
      : { insert: activityInsert })
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }) })
    const created = await POST(request, { params: Promise.resolve({ id: 'lead-1' }) })
    expect(created.status).toBe(200)
    expect((await created.json()).imported).toBe(true)
    expect(activityInsert).toHaveBeenCalledTimes(1)

    const existingQuery = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
    existingQuery.eq.mockReturnValue(existingQuery)
    from.mockImplementation((table: string) => table === 'lead_meeting_notes'
      ? { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } }) })) })), select: vi.fn(() => existingQuery) }
      : { insert: activityInsert })
    const duplicate = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }) }), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(await duplicate.json()).toMatchObject({ imported: false, meetingNote: { id: row.id } })
    expect(activityInsert).toHaveBeenCalledTimes(1)
    expect(fetchGranolaNote).toHaveBeenCalledWith(granolaDoc.id)
  })
})
