import { describe, expect, it } from 'vitest'
import { mergeLinkedNotes, type LinkedMatterNote } from '@/app/admin/matters/[id]/tabs/notes'

describe('converted matter history', () => {
  it('shows linked lead and matter notes once in chronological order with stable source identities', () => {
    const notes = mergeLinkedNotes(
      [{ id: 'lead-note-1', body: 'Lead note', created_at: '2026-07-01T00:00:00Z', origin: 'lead', sourceId: 'lead-note-1', note_type: 'internal' }],
      [
        { id: 'matter-note-1', body: 'Matter note', created_at: '2026-07-03T00:00:00Z', origin: 'matter', sourceId: 'matter-note-1', note_type: 'internal' },
        { id: 'copied-note', body: 'Copied lead note', created_at: '2026-07-02T00:00:00Z', origin: 'matter', sourceId: 'copied-note', sourceLeadNoteId: 'lead-note-1', note_type: 'internal' },
      ],
    )

    expect(notes.map(note => note.id)).toEqual(['matter:matter-note-1', 'matter:copied-note'])
    expect(notes.map(note => note.origin)).toEqual(['matter', 'matter'])
  })

  it('keeps lead note edits routed to the linked lead endpoint', () => {
    const note: LinkedMatterNote = {
      id: 'lead:lead-note-1', sourceId: 'lead-note-1', origin: 'lead', leadId: 'lead-1',
      body: 'Lead note', created_at: '2026-07-01T00:00:00Z', note_type: 'internal',
    }
    expect(note.origin).toBe('lead')
    expect(`/api/admin/leads/${note.leadId}/notes/${note.sourceId}`).toBe('/api/admin/leads/lead-1/notes/lead-note-1')
  })
})
