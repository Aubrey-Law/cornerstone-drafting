'use client'

import { memo, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { Calendar, Check, Pencil, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormattedNote } from '@/components/notes/FormattedNote'
import { FormattedNoteEditor } from '@/components/notes/FormattedNoteEditor'
import { TabsContent } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { RecordTabHeader } from '@/components/RecordTabHeader'
import { cn, formatDateTime } from '@/lib/utils'
import { AssistantNotePromptButton } from '@/app/admin/components/AssistantNotePromptButton'
import type { LinkedMatterNote } from './noteLinks'
export { linkLiveMatterNotes, mapMatterNoteRows, mergeLinkedNotes } from './noteLinks'
export type { LinkedMatterNote } from './noteLinks'

type EditableNoteType = 'Internal' | 'Client comm.'
type MatterNoteListItem = LinkedMatterNote

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
  handleDeleteLeadNote?: (note: LinkedMatterNote) => Promise<void>
  handleUpdateLeadNote?: (note: LinkedMatterNote) => Promise<void>
  startEditingNote: (note: MatterNoteListItem) => void
}

function NoteTypeToggle({ value, onChange }: { value: EditableNoteType; onChange: (type: EditableNoteType) => void }) {
  return (
    <div role="group" aria-label="Note type" className="flex gap-1">
      {(['Internal', 'Client comm.'] as const).map(type => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          onClick={() => onChange(type)}
          className={cn(
            'rounded-full px-3 py-1 text-micro font-medium',
            value === type
              ? type === 'Internal'
                ? 'bg-brand-navy text-white'
                : 'bg-primary text-primary-foreground'
              : 'bg-page-bg text-text-tertiary hover:bg-border'
          )}
        >
          {type}
        </button>
      ))}
    </div>
  )
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
    handleDeleteLeadNote,
    handleUpdateLeadNote,
    startEditingNote,
  } = props

  return (
    <TabsContent value="notes" className="mt-0 space-y-4">
      <RecordTabHeader
        title="Notes"
        description="Internal notes, client-communication notes, and meeting notes for this matter."
      />

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-micro font-medium text-muted-foreground">Draft with AI</p>
          <AssistantNotePromptButton />
        </div>
        <FormattedNoteEditor
          textareaRef={textareaRef}
          ariaLabel="New matter note"
          placeholder="Add a note... (Cmd+Enter to save)"
          value={noteText}
          onChange={setNoteText}
          rows={3}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleAddNote()
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <NoteTypeToggle value={noteType} onChange={setNoteType} />
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!noteText.trim() || noteSaving}
            onClick={handleAddNote}
          >
            <Send className="h-3.5 w-3.5" /> Add note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={Pencil}
            className="py-8"
            title="No notes yet"
            description="Internal notes and client-communication notes you add appear here."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notes.map(note => {
            const isSystem = note.note_type === 'system'
            const isInternal = note.note_type === 'internal'
            const isEditable = note.note_type === 'internal' || note.note_type === 'client_comm'
            const isLead = note.origin === 'lead'
            const isEditing = editingNoteId === note.sourceId
            const isMutating = noteMutatingId === note.sourceId
            // Merged ids read "matter:opt-…", so the optimistic marker is on sourceId.
            const isPending = note.sourceId.startsWith('opt-')
            const displayContent = note.body ?? ''
            return (
              <div key={note.id} className={cn('rounded-lg border bg-card p-4', isSystem ? 'border-border/60 bg-surface-1' : 'border-border', isPending && 'opacity-60')}>
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isSystem ? (
                      <span className="flex items-center gap-1 rounded-full bg-page-bg border border-border px-2 py-0.5 text-micro font-semibold text-text-tertiary">
                        <Calendar className="h-2.5 w-2.5" /> System
                      </span>
                    ) : (
                      <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', isInternal ? 'bg-brand-navy/8 text-brand-navy' : 'bg-primary/8 text-primary')}>
                        {isInternal ? 'Internal' : 'Client comm.'}
                      </span>
                    )}
                    <span className="text-micro text-text-tertiary">
                      {formatDateTime(note.created_at)}
                    </span>
                    {isLead && <span className="rounded-full border border-border px-2 py-0.5 text-micro font-semibold text-muted-foreground">From lead</span>}
                  </div>
                  {isEditable && !isPending && (
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2 text-micro"
                            disabled={!editingNoteText.trim() || isMutating}
                            onClick={() => void (isLead ? handleUpdateLeadNote?.(note) : handleUpdateNote())}
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
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isMutating} onClick={() => startEditingNote({ ...note, id: note.sourceId })} aria-label="Edit note">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" disabled={isMutating} onClick={() => void (isLead ? handleDeleteLeadNote?.(note) : handleDeleteNote(note.sourceId))} aria-label="Delete note">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    {/* A lead note's PATCH saves the body only, so a type toggle there would be ignored. */}
                    {!isLead && <NoteTypeToggle value={editingNoteType} onChange={setEditingNoteType} />}
                    <FormattedNoteEditor
                      ariaLabel="Edit note body"
                      value={editingNoteText}
                      onChange={setEditingNoteText}
                      rows={3}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void (isLead ? handleUpdateLeadNote?.(note) : handleUpdateNote())
                        }
                      }}
                    />
                  </div>
                ) : (
                  <FormattedNote className={isSystem ? 'text-text-secondary' : 'text-text-primary'}>
                    {displayContent}
                  </FormattedNote>
                )}
              </div>
            )
          })}
        </div>
      )}

      {meetingNotes}
    </TabsContent>
  )
}


export const MatterNotesTab = memo(MatterNotesTabImpl)
