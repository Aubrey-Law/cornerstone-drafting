// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from '@/components/ui/tabs'
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
    const sql = fs.readFileSync('supabase/migrations/20260730020000_link_lead_history.sql', 'utf8')
    expect(sql).toContain('source_lead_note_id')
    expect(sql).toContain('references public.lead_notes(id)')
    expect(sql).toContain('unique')
  })

  it('surfaces core, intake, and linked-history loader query errors', () => {
    const source = fs.readFileSync('app/admin/matters/[id]/page.tsx', 'utf8')
    expect(source).toContain('clientIntakeError')
    expect(source).toContain('Could not load client intake')
    expect(source).toContain('Could not load linked lead history')
  })
})
