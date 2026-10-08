'use client'

import { useState } from 'react'
import { addMatterNote, deleteMatterNote, updateMatterNote, type MatterNoteRow } from '@/app/actions/matterNotes'
import { logMatterActivity } from '@/lib/matterActivity'
import { getFirmConfig } from '@/lib/firmConfig'
import { toast } from 'sonner'
import type { MatterActivity } from '@/types/database'

type EditableNoteType = 'Internal' | 'Client comm.'
type EditableNoteInput = Pick<MatterNoteRow, 'id' | 'body' | 'note_type'>

interface UseMatterNotesArgs {
  initialNotes: MatterNoteRow[]
  matterId: string
  onActivityLogged?: (activity: MatterActivity) => void
}

export function useMatterNotes({ initialNotes, matterId, onActivityLogged }: UseMatterNotesArgs) {
  const [noteType, setNoteType] = useState<EditableNoteType>('Internal')
  const [noteText, setNoteText] = useState('')
  const [notes, setNotes] = useState<MatterNoteRow[]>(initialNotes)
  const authorName = getFirmConfig().attorneyShortName
  const [noteSaving, setNoteSaving] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editingNoteType, setEditingNoteType] = useState<EditableNoteType>('Internal')
  const [noteMutatingId, setNoteMutatingId] = useState<string | null>(null)

  const handleAddNote = async (typeOverride?: EditableNoteType) => {
    const text = noteText.trim()
    if (!text) return
    const dbType = (typeOverride ?? noteType) === 'Internal' ? 'internal' : 'client_comm'
    const optimistic: MatterNoteRow = {
      id: `opt-${Date.now()}`,
      matter_id: matterId,
      note_type: dbType,
      body: text,
      author: authorName,
      created_at: new Date().toISOString(),
    }
    setNotes(prev => [optimistic, ...prev])
    setNoteText('')
    setNoteSaving(true)
    let saved: MatterNoteRow
    try {
      saved = await addMatterNote(matterId, text, dbType)
    } catch (error) {
      // Put the words back rather than dropping them with the optimistic row,
      // unless something new has been typed since.
      setNotes(prev => prev.filter(note => note.id !== optimistic.id))
      setNoteText(current => (current.trim() ? current : text))
      toast.error(error instanceof Error ? error.message : 'Could not save note')
      setNoteSaving(false)
      return
    }
    setNotes(prev => prev.map(note => note.id === optimistic.id ? saved : note))
    setNoteSaving(false)
    // The note is saved; a failed activity entry must not take it off the list.
    try {
      const activity = await logMatterActivity(
        matterId,
        'note_added',
        dbType === 'client_comm' ? 'Client communication logged' : 'Note added',
        { detail: text.length > 140 ? `${text.slice(0, 140)}...` : text, metadata: { type: dbType, note_id: saved.id } },
      )
      if (activity) onActivityLogged?.(activity)
    } catch {
      // Activity is best-effort.
    }
  }

  const handleLogCall = async (outcome: string, detail: string): Promise<boolean> => {
    const body = `Call — ${outcome}${detail.trim() ? `\n${detail.trim()}` : ''}`
    try {
      const saved = await addMatterNote(matterId, body, 'client_comm')
      setNotes(previous => [saved, ...previous])
      // The durable communication note is the source of truth; activity is best-effort.
      try {
        const entry = await logMatterActivity(matterId, 'note_added', 'Call logged', {
          detail: body, metadata: { type: 'client_comm', channel: 'call', outcome, note_id: saved.id },
        })
        if (entry) onActivityLogged?.(entry)
      } catch { /* Do not retry a persisted call because its activity failed. */ }
      toast.success('Call logged')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not log call')
      return false
    }
  }

  const startEditingNote = (note: EditableNoteInput) => {
    if (note.note_type !== 'internal' && note.note_type !== 'client_comm') return
    setEditingNoteId(note.id)
    setEditingNoteText(note.body ?? '')
    setEditingNoteType(note.note_type === 'client_comm' ? 'Client comm.' : 'Internal')
  }

  const cancelEditingNote = () => {
    setEditingNoteId(null)
    setEditingNoteText('')
    setEditingNoteType('Internal')
  }

  const handleUpdateNote = async () => {
    if (!editingNoteId) return
    const text = editingNoteText.trim()
    if (!text) {
      toast.error('Note cannot be blank.')
      return
    }
    const dbType = editingNoteType === 'Internal' ? 'internal' : 'client_comm'
    setNoteMutatingId(editingNoteId)
    try {
      const saved = await updateMatterNote(matterId, editingNoteId, text, dbType)
      setNotes(prev => prev.map(note => note.id === saved.id ? saved : note))
      cancelEditingNote()
      const activity = await logMatterActivity(
        matterId,
        'note_added',
        dbType === 'client_comm' ? 'Client communication updated' : 'Note updated',
        { detail: text.length > 140 ? `${text.slice(0, 140)}...` : text, metadata: { type: dbType, note_id: saved.id } },
      )
      if (activity) onActivityLogged?.(activity)
      toast.success('Note updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update note')
    } finally {
      setNoteMutatingId(null)
    }
  }

  /**
   * Deletes without asking. The question belongs to whoever renders the button
   * — MatterDetailClient asks it with the app's own dialog — because a hook
   * cannot render one, which is why this was still calling window.confirm
   * after the rest of the app had moved off it.
   */
  const handleDeleteNote = async (noteId: string) => {
    const note = notes.find(item => item.id === noteId)
    if (!note || (note.note_type !== 'internal' && note.note_type !== 'client_comm')) return

    setNoteMutatingId(noteId)
    try {
      await deleteMatterNote(matterId, noteId)
      setNotes(prev => prev.filter(item => item.id !== noteId))
      if (editingNoteId === noteId) cancelEditingNote()
      const noteTypeLabel = note.note_type === 'client_comm' ? 'Client communication' : 'Note'
      const activity = await logMatterActivity(
        matterId,
        'note_added',
        `${noteTypeLabel} deleted`,
        { metadata: { type: note.note_type, note_id: noteId } },
      )
      if (activity) onActivityLogged?.(activity)
      toast.success('Note deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete note')
    } finally {
      setNoteMutatingId(null)
    }
  }

  return {
    editingNoteId,
    editingNoteText,
    editingNoteType,
    noteMutatingId,
    noteSaving,
    noteText,
    noteType,
    notes,
    setEditingNoteText,
    setEditingNoteType,
    setNotes,
    setNoteText,
    setNoteType,
    cancelEditingNote,
    handleAddNote,
    handleLogCall,
    handleDeleteNote,
    handleUpdateNote,
    startEditingNote,
  }
}
