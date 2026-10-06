// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn(), log: vi.fn(), toastError: vi.fn() }))
vi.mock('@/app/actions/matterNotes', () => ({ addMatterNote: mocks.add, updateMatterNote: mocks.update, deleteMatterNote: mocks.remove }))
vi.mock('@/lib/matterActivity', () => ({ logMatterActivity: mocks.log }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))
import { Tabs } from '@/components/ui/tabs'
import { MatterNotesTab, linkLiveMatterNotes, mapMatterNoteRows, mergeLinkedNotes, type LinkedMatterNote } from '@/app/admin/matters/[id]/tabs/notes'
import { useMatterNotes } from '@/app/admin/matters/[id]/useMatterNotes'

afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks() })

function renderNotes(overrides: Partial<React.ComponentProps<typeof MatterNotesTab>> = {}) {
  const props: React.ComponentProps<typeof MatterNotesTab> = {
    editingNoteId: null, editingNoteText: '', editingNoteType: 'Internal', noteMutatingId: null,
    noteSaving: false, noteText: '', noteType: 'Internal', notes: [],
    setEditingNoteText: vi.fn(), setEditingNoteType: vi.fn(), setNoteText: vi.fn(), setNoteType: vi.fn(),
    cancelEditingNote: vi.fn(), handleAddNote: vi.fn(), handleDeleteNote: vi.fn(),
    handleUpdateNote: vi.fn(), startEditingNote: vi.fn(), ...overrides,
  }
  return render(<Tabs defaultValue="notes"><MatterNotesTab {...props} /></Tabs>)
}

const saved = { id: 'note-1', matter_id: 'matter-1', note_type: 'internal' as const, body: 'Saved', author: 'AT', created_at: '2026-09-10T12:00:00Z' }

describe('matter notes tab', () => {
  it('offers no edit or delete on a note that is still saving', () => {
    const pending = mergeLinkedNotes([], linkLiveMatterNotes([{ ...saved, id: 'opt-123' }], []))
    renderNotes({ notes: pending })
    expect(pending[0].id).toBe('matter:opt-123')
    expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull()
  })

  it('marks the chosen note type as pressed', () => {
    renderNotes({ noteType: 'Client comm.' })
    const group = screen.getByRole('group', { name: 'Note type' })
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Client comm.')
  })

  it('hides the type toggle when editing a lead note, whose save keeps only the body', () => {
    const lead: LinkedMatterNote = { id: 'n', sourceId: 'lead-1', origin: 'lead', leadId: 'l', body: 'Lead', created_at: saved.created_at, note_type: 'internal' }
    renderNotes({ notes: mergeLinkedNotes([lead], []), editingNoteId: 'lead-1', editingNoteText: 'Lead' })
    expect(screen.getAllByRole('group', { name: 'Note type' })).toHaveLength(1)
  })

  it('shows an edited body and type from live state, keeping the lead link from the page load', () => {
    const loaded = mapMatterNoteRows([{ id: 'note-1', body: 'Old text', created_at: saved.created_at, note_type: 'internal', source_lead_note_id: 'lead-9' }])
    const [note] = linkLiveMatterNotes([{ ...saved, body: 'New text', note_type: 'client_comm' }], loaded)
    expect(note).toMatchObject({ body: 'New text', note_type: 'client_comm', sourceLeadNoteId: 'lead-9' })
  })
})

describe('matter notes tab on a touch screen', () => {
  // jsdom applies no media queries, so these pin the classes the browser keys
  // on: pointer-fine for the keyboard hint, pointer-coarse for touch sizes.
  it('keeps the keyboard shortcut out of the placeholder and shows it only with a fine pointer', () => {
    renderNotes()
    expect(screen.getByRole('textbox', { name: 'New matter note' }).getAttribute('placeholder')).toBe('Add a note…')
    const hint = screen.getByText('⌘Enter to save')
    expect(hint.className).toContain('hidden')
    expect(hint.className).toContain('pointer-fine:inline')
  })

  it('gives the edit and delete buttons a 40px target on a touch screen', () => {
    renderNotes({ notes: mergeLinkedNotes([], linkLiveMatterNotes([saved], [])) })
    for (const name of ['Edit note', 'Delete note']) {
      expect(screen.getByRole('button', { name }).className).toContain('pointer-coarse:size-10')
    }
  })
})

describe('adding a matter note', () => {
  it('puts the text back and says so when the save fails', async () => {
    mocks.add.mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => useMatterNotes({ initialNotes: [], matterId: 'matter-1' }))
    act(() => result.current.setNoteText('Call the bank'))
    await act(() => result.current.handleAddNote())
    expect(result.current.notes).toEqual([])
    expect(result.current.noteText).toBe('Call the bank')
    expect(mocks.toastError).toHaveBeenCalledWith('Offline')
  })

  it('keeps a saved note when only the activity entry fails', async () => {
    mocks.add.mockResolvedValue(saved)
    mocks.log.mockRejectedValue(new Error('activity down'))
    const { result } = renderHook(() => useMatterNotes({ initialNotes: [], matterId: 'matter-1' }))
    act(() => result.current.setNoteText('Saved'))
    await act(() => result.current.handleAddNote())
    expect(result.current.notes.map(note => note.id)).toEqual(['note-1'])
    expect(result.current.noteSaving).toBe(false)
  })
})
