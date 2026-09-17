'use client'

import { useEffect, useRef, useState } from 'react'
import { Combine, GripVertical, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { combineWordDocuments } from '@/lib/documents'

export interface CombinableDraft {
  id: string
  name: string
}

interface CombineWordDraftsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: CombinableDraft[]
  defaultFilename?: string
}

/**
 * Pick which Word drafts to merge into a single .docx and drag rows to set
 * their order. Every document keeps its own formatting in the combined file;
 * each one starts on a new page.
 */
export function CombineWordDraftsDialog({
  open,
  onOpenChange,
  documents,
  defaultFilename,
}: CombineWordDraftsDialogProps) {
  const [ordered, setOrdered] = useState<CombinableDraft[]>(documents)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(documents.map(d => d.id)))
  const [combining, setCombining] = useState(false)

  // Re-seed the working list each time the dialog opens so it reflects the
  // current drafts (a regeneration can replace them while the page is open).
  useEffect(() => {
    if (!open) return
    setOrdered(documents)
    setSelectedIds(new Set(documents.map(d => d.id)))
  }, [documents, open])

  // Native HTML5 drag-and-drop (same approach as the pipeline kanban): the
  // list reorders live as the dragged row passes over its siblings.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  const handleRowDragOver = (overIndex: number) => {
    const from = dragIndexRef.current
    if (from === null || from === overIndex) return
    dragIndexRef.current = overIndex
    setOrdered(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(overIndex, 0, moved)
      return next
    })
  }

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectedInOrder = ordered.filter(doc => selectedIds.has(doc.id))

  const handleCombine = async () => {
    if (combining || selectedInOrder.length < 2) return
    setCombining(true)
    try {
      await combineWordDocuments(selectedInOrder.map(doc => doc.id), defaultFilename)
      toast.success(`Combined ${selectedInOrder.length} documents into one Word file`)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not combine documents')
    } finally {
      setCombining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!combining) onOpenChange(next) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Combine Word documents</DialogTitle>
          <DialogDescription>
            Choose which drafts to include and drag rows to arrange their order. Each document
            keeps its own formatting and starts on a new page in the combined file.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto py-1">
          {ordered.map((doc, index) => {
            const included = selectedIds.has(doc.id)
            const position = included ? selectedInOrder.findIndex(d => d.id === doc.id) + 1 : null
            const isDragging = draggingId === doc.id
            return (
              <div
                key={doc.id}
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move'
                  // Some browsers cancel the drag without payload data.
                  event.dataTransfer.setData('text/plain', doc.id)
                  dragIndexRef.current = index
                  setDraggingId(doc.id)
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null
                  setDraggingId(null)
                }}
                onDragOver={event => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  handleRowDragOver(index)
                }}
                onDrop={event => event.preventDefault()}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                  isDragging
                    ? 'border-selected-border bg-selected opacity-60'
                    : 'border-border bg-muted'
                }`}
              >
                <span
                  className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
                  aria-hidden="true"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <Checkbox
                  checked={included}
                  onCheckedChange={checked => toggle(doc.id, checked === true)}
                  aria-label={`Include ${doc.name}`}
                />
                <span className="w-5 shrink-0 text-center text-micro font-semibold text-muted-foreground">
                  {position ?? '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={doc.name}>
                  {doc.name}
                </span>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={combining}>
            Cancel
          </Button>
          <Button
            onClick={handleCombine}
            disabled={combining || selectedInOrder.length < 2}
            className="gap-1.5"
          >
            {combining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Combine className="h-3.5 w-3.5" />}
            {combining
              ? 'Combining…'
              : `Combine ${selectedInOrder.length} document${selectedInOrder.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
