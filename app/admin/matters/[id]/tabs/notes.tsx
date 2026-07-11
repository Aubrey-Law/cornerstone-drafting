'use client'

import { memo, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { Calendar, Check, Pencil, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import { AssistantNotePromptButton } from '@/app/admin/components/AssistantNotePromptButton'

type EditableNoteType = 'Internal' | 'Client comm.'
type MatterNoteListItem = Pick<MatterNoteRow, 'id' | 'body' | 'created_at' | 'note_type'>

interface MatterNotesTabProps {
  editingNoteId: string | null
  editingNoteText: string
  editingNoteType: EditableNoteType
  noteMutatingId: string | null
  noteSaving: boolean
  noteText: string
  noteType: EditableNoteType
  notes: MatterNoteListItem[]
  /** Meeting-note documents section (Granola imports), rendered below text notes. */
  meetingNotes?: ReactNode
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  setEditingNoteText: Dispatch<SetStateAction<string>>
  setEditingNoteType: Dispatch<SetStateAction<EditableNoteType>>
  setNoteText: Dispatch<SetStateAction<string>>
  setNoteType: Dispatch<SetStateAction<EditableNoteType>>
  cancelEditingNote: () => void
  handleAddNote: () => Promise<void>
  handleDeleteNote: (noteId: string) => Promise<void>
  handleUpdateNote: () => Promise<void>
  startEditingNote: (note: MatterNoteListItem) => void
}

function MatterNotesTabImpl(props: MatterNotesTabProps) {
  const {
    editingNoteId,
    editingNoteText,
    editingNoteType,
    noteMutatingId,
    noteSaving,
    noteText,
    noteType,
    notes,
    meetingNotes,
    textareaRef,
    setEditingNoteText,
    setEditingNoteType,
    setNoteText,
    setNoteType,
    cancelEditingNote,
    handleAddNote,
    handleDeleteNote,
    handleUpdateNote,
    startEditingNote,
  } = props

  return (
    <TabsContent value="notes" className="mt-0 space-y-4">
      {notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-text-tertiary">
          <Pencil className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No notes yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => {
            const isSystem = note.note_type === 'system'
            const isInternal = note.note_type === 'internal'
            const isEditable = note.note_type === 'internal' || note.note_type === 'client_comm'
            const isEditing = editingNoteId === note.id
            const isMutating = noteMutatingId === note.id
            const displayContent = note.body ?? ''
            return (
              <div key={note.id} className={cn('rounded-lg border bg-card p-4', isSystem ? 'border-border/60 bg-surface-1' : 'border-border', note.id.startsWith('opt-') && 'opacity-60')}>
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isSystem ? (
                      <span className="flex items-center gap-1 rounded-full bg-page-bg border border-border px-2 py-0.5 text-[10px] font-semibold text-text-tertiary">
                        <Calendar className="h-2.5 w-2.5" /> System
                      </span>
                    ) : (
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', isInternal ? 'bg-brand-navy/8 text-brand-navy' : 'bg-accent/8 text-accent')}>
                        {isInternal ? 'Internal' : 'Client comm.'}
                      </span>
                    )}
                    <span className="text-[11px] text-text-tertiary">
                      {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  {isEditable && !note.id.startsWith('opt-') && (
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            disabled={!editingNoteText.trim() || isMutating}
                            onClick={() => void handleUpdateNote()}
                          >
                            <Check className="h-3 w-3" />
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isMutating} onClick={cancelEditingNote} aria-label="Cancel note edit">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isMutating} onClick={() => startEditingNote(note)} aria-label="Edit note">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" disabled={isMutating} onClick={() => void handleDeleteNote(note.id)} aria-label="Delete note">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      {(['Internal', 'Client comm.'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setEditingNoteType(type)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[11px] font-medium',
                            editingNoteType === type
                              ? type === 'Internal'
                                ? 'bg-brand-navy text-white'
                                : 'bg-accent text-white'
                              : 'bg-page-bg text-text-tertiary hover:bg-border'
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      value={editingNoteText}
                      onChange={event => setEditingNoteText(event.target.value)}
                      rows={3}
                      className="resize-none text-sm"
                      onKeyDown={event => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void handleUpdateNote()
                        }
                      }}
                    />
                  </div>
                ) : (
                  <p className={cn('whitespace-pre-wrap text-sm', isSystem ? 'text-text-secondary' : 'text-text-primary')}>{displayContent}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">AI assistant</p>
          <AssistantNotePromptButton />
        </div>
        <Textarea
          ref={textareaRef}
          placeholder="Add a note... (Cmd+Enter to save)"
          value={noteText}
          onChange={event => setNoteText(event.target.value)}
          rows={3}
          className="resize-none text-sm"
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleAddNote()
            }
          }}
        />
        <div className="flex gap-1">
          {(['Internal', 'Client comm.'] as const).map(type => (
            <button
              key={type}
              onClick={() => setNoteType(type)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium',
                noteType === type
                  ? type === 'Internal'
                    ? 'bg-brand-navy text-white'
                    : 'bg-accent text-white'
                  : 'bg-page-bg text-text-tertiary hover:bg-border'
              )}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button
            size="sm"
            className="gap-1 bg-accent text-xs text-white"
            disabled={!noteText.trim() || noteSaving}
            onClick={handleAddNote}
          >
            <Send className="h-3 w-3" /> Add Note
          </Button>
        </div>
      </div>

      {meetingNotes}
    </TabsContent>
  )
}


export const MatterNotesTab = memo(MatterNotesTabImpl)
