// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdmin, fetchGranolaNote, isGranolaNoteId, rpc } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  fetchGranolaNote: vi.fn(),
  isGranolaNoteId: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/granola', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/granola')>()),
  fetchGranolaNote,
  isGranolaNoteId,
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc }) }))

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

  it('does not duplicate an existing meeting in the rendered list after an idempotent import', async () => {
    const meeting = { id: row.id, title: row.title, date: row.meeting_date, attendees: row.attendees, body: row.body, source: row.source, granolaNoteId: row.granola_note_id, actorId: row.actor_id, createdAt: row.created_at, updatedAt: row.updated_at }
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ notes: [{ id: granolaDoc.id, title: granolaDoc.title, createdAt: row.created_at }] }))
      .mockResolvedValueOnce(response({ title: granolaDoc.title, meetingDate: granolaDoc.meetingDate, content: granolaDoc.notesMarkdown, attendees: granolaDoc.attendees }))
      .mockResolvedValueOnce(response({ meetingNote: meeting, imported: false }))
    const user = userEvent.setup()
    render(<LeadNotesCard leadId="lead-1" initialNotes={[]} initialMeetingNotes={[meeting]} currentUser={{ id: 'user-1', role: 'attorney' }} />)
    await user.click(screen.getByRole('button', { name: 'Import from Granola' }))
    await user.click(await screen.findByRole('button', { name: new RegExp(granolaDoc.title) }))
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('Meeting notes list').querySelectorAll('article')).toHaveLength(1)
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

  it('delegates note and activity creation to one atomic, idempotent RPC', async () => {
    rpc.mockResolvedValueOnce({ data: [{ meeting_note: row, imported: true }], error: null })
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }) })
    const created = await POST(request, { params: Promise.resolve({ id: 'lead-1' }) })
    expect(created.status).toBe(200)
    expect((await created.json()).imported).toBe(true)
    expect(rpc).toHaveBeenCalledWith('import_lead_granola_note_with_activity', expect.objectContaining({
      p_lead_id: 'lead-1', p_granola_note_id: granolaDoc.id, p_actor_id: 'user-1',
    }))

    rpc.mockResolvedValueOnce({ data: [{ meeting_note: row, imported: false }], error: null })
    const duplicate = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }) }), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(await duplicate.json()).toMatchObject({ imported: false, meetingNote: { id: row.id } })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(fetchGranolaNote).toHaveBeenCalledWith(granolaDoc.id)

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'activity insert failed' } })
    const failed = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ noteId: granolaDoc.id }) }), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'activity insert failed' })
  })

  it('defines the atomic import so activity failure rolls back the note and duplicates add no activity', () => {
    const sql = fs.readFileSync('supabase/migrations/20260713020923_atomic_lead_notes.sql', 'utf8')
    expect(sql).toContain('function public.import_lead_granola_note_with_activity')
    expect(sql).toContain('on conflict (lead_id,granola_note_id)')
    expect(sql).toContain('if v_imported then')
    expect(sql).toContain("insert into public.lead_activity")
    expect(sql).toContain('grant execute on function public.import_lead_granola_note_with_activity')
    expect(sql).toContain('to service_role')
    expect(sql).toContain('perform public.assert_lead_note_actor(p_actor_id)')
  })
})
