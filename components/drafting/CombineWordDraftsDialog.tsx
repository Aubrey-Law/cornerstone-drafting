'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Combine, Loader2 } from 'lucide-react'
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
 * Pick which Word drafts to merge into a single .docx and set their order.
 * Every document keeps its own formatting in the combined file; each one
 * starts on a new page.
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

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    setOrdered(prev => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
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
            Choose which drafts to include and arrange their order. Each document keeps its own
            formatting and starts on a new page in the combined file.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto py-1">
          {ordered.map((doc, index) => {
            const included = selectedIds.has(doc.id)
            const position = included ? selectedInOrder.findIndex(d => d.id === doc.id) + 1 : null
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
              >
                <Checkbox
                  checked={included}
                  onCheckedChange={checked => toggle(doc.id, checked === true)}
                  aria-label={`Include ${doc.name}`}
                />
                <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">
                  {position ?? '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={doc.name}>
                  {doc.name}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${doc.name} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${doc.name} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
