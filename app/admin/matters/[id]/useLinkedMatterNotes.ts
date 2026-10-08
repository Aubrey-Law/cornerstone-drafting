'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import { linkLiveMatterNotes, mergeLinkedNotes, type LinkedMatterNote } from './tabs/notes'

export type LeadNoteRow = { id: string; lead_id: string; body: string; created_at: string; note_type: 'internal' | 'system' }

/**
 * The Notes tab shows matter notes and the notes carried over from the lead.
 * Lead notes edit and delete through the lead routes; the delete is confirmed
 * by a dialog the page renders from `deleteTarget`.
 */
export function useLinkedMatterNotes({ initialLeadNotes, initialMatterLinkedNotes, notes, editingNoteText, cancelEditingNote }: {
  initialLeadNotes: LeadNoteRow[]
  initialMatterLinkedNotes: LinkedMatterNote[]
  notes: MatterNoteRow[]
  editingNoteText: string
  cancelEditingNote: () => void
}) {
  const [leadNotes, setLeadNotes] = useState(initialLeadNotes)
  const [deleteTarget, setDeleteTarget] = useState<LinkedMatterNote | null>(null)

  const linkedNotes = useMemo(() => mergeLinkedNotes(
    leadNotes.map(note => ({ id: note.id, sourceId: note.id, origin: 'lead' as const, leadId: note.lead_id, body: note.body, created_at: note.created_at, note_type: note.note_type })),
    linkLiveMatterNotes(notes, initialMatterLinkedNotes),
  ), [initialMatterLinkedNotes, leadNotes, notes])

  const updateLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    const body = editingNoteText.trim()
    const response = await fetch(`/api/admin/leads/${note.leadId}/notes/${note.sourceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    })
    if (!response.ok) {
      toast.error('Could not update lead note')
      return
    }
    setLeadNotes(current => current.map(item => item.id === note.sourceId ? { ...item, body } : item))
    cancelEditingNote()
    toast.success('Lead note updated')
  }

  const requestDeleteLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    setDeleteTarget(note)
  }

  const deleteLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    const response = await fetch(`/api/admin/leads/${note.leadId}/notes/${note.sourceId}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Could not delete lead note')
      return
    }
    setLeadNotes(current => current.filter(item => item.id !== note.sourceId))
    toast.success('Lead note deleted')
  }

  return { linkedNotes, updateLeadNote, requestDeleteLeadNote, deleteLeadNote, deleteTarget, setDeleteTarget }
}
