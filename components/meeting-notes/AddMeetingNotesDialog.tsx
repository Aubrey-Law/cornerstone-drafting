'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileText, Loader2, NotebookPen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { cn, formatDate } from '@/lib/utils'

interface GranolaNoteSummary {
  id: string
  title: string
  createdAt: string
}

interface AddMeetingNotesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { kind: 'lead' | 'matter'; id: string }
  onImported?: (note: unknown) => void
}

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function AddMeetingNotesDialog({
  open,
  onOpenChange,
  target,
  onImported,
}: AddMeetingNotesDialogProps) {
  const token = useAccessToken()
  const [title, setTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState(todayIso())
  const [sourceUrl, setSourceUrl] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [pickedNoteId, setPickedNoteId] = useState<string | null>(null)

  const [recent, setRecent] = useState<GranolaNoteSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [fetchingNoteId, setFetchingNoteId] = useState<string | null>(null)

  const authHeaders = useCallback((): HeadersInit => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }, [token])

  const loadRecent = useCallback(async () => {
    if (!token) return
    setListLoading(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/granola/list?sinceDays=14', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `List failed (${res.status})`)
      setRecent(json.notes ?? [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load Granola meetings')
      setRecent([])
    } finally {
      setListLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (open) {
      setTitle('')
      setMeetingDate(todayIso())
      setSourceUrl('')
      setContent('')
      setPickedNoteId(null)
      setRecent(null)
      setListError(null)
      void loadRecent()
    }
  }, [open, loadRecent])

  async function handlePick(note: GranolaNoteSummary) {
    if (!token) return
    setFetchingNoteId(note.id)
    try {
      const res = await fetch('/api/admin/granola/fetch', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ noteId: note.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Fetch failed (${res.status})`)

      if (typeof json.title === 'string' && json.title) setTitle(json.title)
      if (typeof json.meetingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.meetingDate)) {
        setMeetingDate(json.meetingDate)
      }
      if (typeof json.content === 'string') setContent(json.content)
      if (typeof json.sourceUrl === 'string') setSourceUrl(json.sourceUrl)
      setPickedNoteId(note.id)
      toast.success('Pulled from Granola')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch from Granola')
    } finally {
      setFetchingNoteId(null)
    }
  }

  async function handleSave() {
    if (!token) return
    if (!title.trim()) {
      toast.error('Add a title')
      return
    }
    if (!content.trim()) {
      toast.error('Pick a meeting or paste notes')
      return
    }

    setSaving(true)
    try {
      const isLead = target.kind === 'lead'
      if (isLead && !pickedNoteId) {
        toast.error('Pick a Granola meeting')
        return
      }
      const res = await fetch(
        isLead
          ? `/api/admin/leads/${target.id}/meeting-notes/granola`
          : '/api/admin/meeting-notes', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(isLead ? { noteId: pickedNoteId } : {
          matterId: target.id, title: title.trim(), meetingDate,
          sourceUrl: sourceUrl.trim() || undefined, source: 'granola', content,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`)

      toast.success('Meeting notes saved')
      onImported?.(json.meetingNote ?? json.document ?? json)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save meeting notes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-4 pb-4 pt-5 pr-10 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-primary" />
            Add meeting notes
          </DialogTitle>
          <DialogDescription>
            Pick a recent Granola meeting or fill in the fields manually. Saved as an internal{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-sans text-micro">meeting-notes</code>{' '}
            document. Never visible to the client.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3 sm:items-center">
              <Label>Pick from your recent Granola meetings</Label>
              <button
                type="button"
                onClick={() => void loadRecent()}
                disabled={listLoading || !token}
                className="flex items-center gap-1 text-micro text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={cn('h-3 w-3', listLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card">
              {listLoading && !recent ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              ) : listError ? (
                <div className="px-3 py-4 text-xs text-destructive">{listError}</div>
              ) : recent && recent.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">
                  No Granola meetings in the last 14 days.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {(recent ?? []).map((note) => {
                    const isPicked = pickedNoteId === note.id
                    const isFetching = fetchingNoteId === note.id
                    return (
                      <li key={note.id}>
                        <button
                          type="button"
                          onClick={() => void handlePick(note)}
                          disabled={saving || fetchingNoteId !== null}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                            'hover:bg-accent disabled:opacity-60',
                            isPicked && 'bg-primary/5',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-compact font-medium text-foreground">
                              {note.title}
                            </p>
                            <p className="text-micro text-muted-foreground">
                              {formatDate(note.createdAt)}
                            </p>
                          </div>
                          {isFetching ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                          ) : isPicked ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mn-title">Title</Label>
            <Input
              id="mn-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Initial consult — Smith family"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mn-date">Meeting date</Label>
            <Input
              id="mn-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              disabled={saving}
              className="w-48"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mn-content" className="flex items-center justify-between">
              <span>Notes</span>
              <span className="text-micro font-normal text-muted-foreground">
                Markdown supported
              </span>
            </Label>
            <ResizableTextarea
              id="mn-content"
              handleLabel="Resize the notes box"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Pick a meeting above to auto-fill, or paste notes here…"
              rows={12}
              className="text-xs"
              disabled={saving}
            />
            <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
              <FileText className="h-3 w-3" />
              Saved as a single .md file
            </p>
          </div>
        </div>

        <DialogFooter className="border-t bg-background px-4 py-3 sm:px-6 sm:py-4">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || !token}>
            {saving ? 'Saving…' : 'Save notes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
