// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from '@/components/ui/tabs'
import { buildLinkedMatterActivity } from '@/lib/leads/activity'
import { MatterActivityTab } from '@/app/admin/matters/[id]/MatterActivityTab'
import {
  MatterNotesTab,
  mapMatterNoteRows,
  mergeLinkedNotes,
  type LinkedMatterNote,
} from '@/app/admin/matters/[id]/tabs/notes'

afterEach(() => cleanup())

const lead: LinkedMatterNote = {
  id: 'lead-note-1', sourceId: 'lead-note-1', origin: 'lead', leadId: 'lead-1',
  body: 'Lead note', created_at: '2026-07-01T00:00:00Z', note_type: 'internal',
}

function renderNotes(overrides: Partial<React.ComponentProps<typeof MatterNotesTab>> = {}) {
  const props: React.ComponentProps<typeof MatterNotesTab> = {
    editingNoteId: null, editingNoteText: '', editingNoteType: 'Internal', noteMutatingId: null,
    noteSaving: false, noteText: '', noteType: 'Internal', notes: [lead],
    setEditingNoteText: vi.fn(), setEditingNoteType: vi.fn(), setNoteText: vi.fn(), setNoteType: vi.fn(),
    cancelEditingNote: vi.fn(), handleAddNote: vi.fn(), handleDeleteNote: vi.fn(),
    handleUpdateNote: vi.fn(), handleDeleteLeadNote: vi.fn(), handleUpdateLeadNote: vi.fn(),
    startEditingNote: vi.fn(), ...overrides,
  }
  const view = render(<Tabs defaultValue="notes"><MatterNotesTab {...props} /></Tabs>)
  return { props, ...view }
}

describe('converted matter history', () => {
  it('maps loader provenance and renders linked notes once in chronological order with origin labels', () => {
    const matter = mapMatterNoteRows([
      { id: 'matter-note-1', body: 'Newest matter note', created_at: '2026-07-03T00:00:00Z', note_type: 'internal', source_lead_note_id: null },
      { id: 'represented', body: 'Represented lead note', created_at: '2026-07-02T00:00:00Z', note_type: 'internal', source_lead_note_id: 'lead-note-1' },
    ])
    const notes = mergeLinkedNotes([lead], matter)
    const { container } = renderNotes({ notes })
    expect(notes.map(note => note.id)).toEqual(['matter:matter-note-1', 'matter:represented'])
    expect(screen.queryByText('Lead note')).toBeNull()
    expect(screen.queryAllByText('From lead')).toHaveLength(0)
    expect(container.textContent!.indexOf('Newest matter note')).toBeLessThan(container.textContent!.indexOf('Represented lead note'))
  })

  it('renders a lead origin label and routes click edit and delete only to lead handlers', async () => {
    const user = userEvent.setup()
    const { props } = renderNotes({ notes: mergeLinkedNotes([lead], []) })
    expect(screen.getByText('From lead')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    expect(props.startEditingNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'lead-note-1', origin: 'lead' }))
    await user.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(props.handleDeleteLeadNote).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'lead-note-1' }))
    expect(props.handleDeleteNote).not.toHaveBeenCalled()
  })

  it('routes Cmd/Ctrl+Enter lead edits only to the lead update handler', () => {
    const { props } = renderNotes({
      notes: mergeLinkedNotes([lead], []), editingNoteId: 'lead-note-1', editingNoteText: 'Edited lead note',
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit note body' }), { key: 'Enter', metaKey: true })
    expect(props.handleUpdateLeadNote).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'lead-note-1' }))
    expect(props.handleUpdateNote).not.toHaveBeenCalled()
  })

  it('preserves matter click and keyboard mutation routing', async () => {
    const matter = mapMatterNoteRows([{ id: 'matter-1', body: 'Matter note', created_at: '2026-07-03T00:00:00Z', note_type: 'internal', source_lead_note_id: null }])[0]
    const user = userEvent.setup()
    const { props } = renderNotes({ notes: [matter], editingNoteId: 'matter-1', editingNoteText: 'Edited matter note' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit note body' }), { key: 'Enter', ctrlKey: true })
    expect(props.handleUpdateNote).toHaveBeenCalledTimes(2)
    expect(props.handleUpdateLeadNote).not.toHaveBeenCalled()
  })

  it('adds immutable note provenance in the pending migration', () => {
    const sql = fs.readFileSync('supabase/migrations/20260713020943_link_lead_history.sql', 'utf8')
    expect(sql).toContain('source_lead_note_id')
    expect(sql).toContain('references public.lead_notes(id)')
    expect(sql).toContain('unique')
  })

  it('surfaces core and intake loader query errors while treating linked history as optional', () => {
    const source = fs.readFileSync('app/admin/matters/[id]/page.tsx', 'utf8')
    const shell = fs.readFileSync('lib/matters/matterShell.ts', 'utf8')
    expect(source).toContain('loadClientIntakeShell')
    expect(shell).toContain('if (base.error) throw new Error(`Could not load client intake: ${base.error.message}`)')
    expect(shell).toContain('Could not load client intake')
    expect(source).toContain('Linked lead history schema unavailable')
    expect(source).toContain('continuing without linked lead history')
  })

  it('renders a loader-linked mirrored activity once in the correct order and origin', () => {
    const activity = buildLinkedMatterActivity('matter-1', [
      { id: 'lead-new', event_type: 'note_added', title: 'Lead-only event', detail: null, actor_id: null, created_at: '2026-07-04T00:00:00Z', source_matter_activity_id: null },
      { id: 'lead-mirror', event_type: 'matter_created', title: 'Mirrored event', detail: null, actor_id: null, created_at: '2026-07-03T00:00:00Z', source_matter_activity_id: 'matter-mirror' },
    ], [
      { id: 'matter-mirror', matter_id: 'matter-1', event_type: 'matter_created', title: 'Matter event', detail: null, actor_id: null, actor_email: null, actor_name: null, metadata: null, created_at: '2026-07-03T00:00:00Z' },
      { id: 'matter-old', matter_id: 'matter-1', event_type: 'stage_changed', title: 'Old matter event', detail: null, actor_id: null, actor_email: null, actor_name: null, metadata: null, created_at: '2026-07-01T00:00:00Z' },
    ])
    const { container } = render(<MatterActivityTab activity={activity} loading={false} />)

    expect(activity.map(row => row.id)).toEqual(['lead:lead-new', 'matter-mirror', 'matter-old'])
    expect(screen.getAllByText('From lead')).toHaveLength(1)
    expect(screen.queryByText('Mirrored event')).toBeNull()
    expect(container.textContent!.indexOf('Lead-only event')).toBeLessThan(container.textContent!.indexOf('Matter event'))
  })
})
