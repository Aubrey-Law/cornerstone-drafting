import type { MatterNoteRow } from '@/app/actions/matterNotes'

export type LinkedMatterNote = Pick<MatterNoteRow, 'body' | 'created_at' | 'note_type'> & {
  id: string
  sourceId: string
  origin: 'lead' | 'matter'
  leadId?: string
  sourceLeadNoteId?: string | null
}

export function mergeLinkedNotes(lead: LinkedMatterNote[], matter: LinkedMatterNote[]): LinkedMatterNote[] {
  const representedLeadIds = new Set(matter.map(note => note.sourceLeadNoteId).filter(Boolean))
  return [...matter, ...lead.filter(note => !representedLeadIds.has(note.sourceId))]
    .map(note => ({ ...note, id: `${note.origin}:${note.sourceId}` }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

type MatterNoteLoaderRow = Pick<MatterNoteRow, 'id' | 'body' | 'created_at' | 'note_type'> & {
  source_lead_note_id: string | null
}

export function mapMatterNoteRows(rows: MatterNoteLoaderRow[]): LinkedMatterNote[] {
  return rows.map(note => ({
    id: note.id,
    sourceId: note.id,
    origin: 'matter',
    body: note.body,
    created_at: note.created_at,
    note_type: note.note_type,
    sourceLeadNoteId: note.source_lead_note_id,
  }))
}

/**
 * Matter notes as the tab shows them. Body and type come from live state, so
 * an edit shows at once; the page-load rows only add the lead-note link.
 */
export function linkLiveMatterNotes(
  notes: Pick<MatterNoteRow, 'id' | 'body' | 'created_at' | 'note_type'>[],
  loaded: LinkedMatterNote[],
): LinkedMatterNote[] {
  return notes.map(note => ({
    id: note.id,
    sourceId: note.id,
    origin: 'matter',
    body: note.body,
    created_at: note.created_at,
    note_type: note.note_type,
    sourceLeadNoteId: loaded.find(linked => linked.sourceId === note.id)?.sourceLeadNoteId ?? null,
  }))
}
