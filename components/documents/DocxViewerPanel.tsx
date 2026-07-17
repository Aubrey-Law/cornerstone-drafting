'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  FileType2,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { highlightDocxQuote } from '@/lib/highlightDocxQuote'
import { clampZoom, nextChangeIndex } from '@/lib/drafting/changeNavigation'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface PendingEdit {
  id: string
  deleted_text: string | null
  inserted_text: string | null
  reason: string | null
  status: string
  del_w_id: string | null
  ins_w_id: string | null
}

interface DocxViewerPanelProps {
  documentId: string
  documentName: string
  quote?: string | null
  /** When true, the panel lays the redline/edits controls in a right rail. */
  maximized?: boolean
  /** Convert this DOCX to a shareable PDF (in-viewer "I'm done" action). */
  onConvert?: () => void
  converting?: boolean
  onClose: () => void
  onMutated?: () => void
}

const ZOOM_STORAGE_KEY = 'docx-viewer-zoom'

export function DocxViewerPanel({
  documentId,
  documentName,
  quote,
  maximized = false,
  onConvert,
  converting = false,
  onClose,
  onMutated,
}: DocxViewerPanelProps) {
  const token = useAccessToken()
  const hostRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [docReady, setDocReady] = useState(false)
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [bulkResolving, setBulkResolving] = useState<'accept' | 'reject' | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [instruction, setInstruction] = useState('')
  const [redlining, setRedlining] = useState(false)
  const [zoom, setZoom] = useState(1)

  // Restore the reviewer's last zoom once on mount (client-only component).
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY))
    if (saved) setZoom(clampZoom(saved))
  }, [])

  const applyZoom = (next: number) => {
    const clamped = clampZoom(next)
    setZoom(clamped)
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped))
  }

  const loadDocx = useCallback(async () => {
    if (!token || !hostRef.current) return
    setLoading(true)
    setDocReady(false)
    try {
      const res = await fetch(`/api/documents/${documentId}/docx`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load DOCX')
      const buf = await res.arrayBuffer()
      hostRef.current.innerHTML = ''
      await renderAsync(buf, hostRef.current, undefined, {
        className: 'docx-preview-body',
        inWrapper: true,
        ignoreWidth: false,
        breakPages: true,
      })

      // Stamp w:ids onto ins/del in document order
      const idsRes = await fetch(`/api/documents/${documentId}/tracked-change-ids`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (idsRes.ok) {
        const { ids } = (await idsRes.json()) as {
          ids: Array<{ kind: 'ins' | 'del'; w_id: string }>
        }
        const nodes = hostRef.current.querySelectorAll('ins, del')
        ids.forEach((item, i) => {
          const el = nodes[i] as HTMLElement | undefined
          if (el) el.dataset.wId = item.w_id
        })
      }

      setDocReady(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not render document')
    } finally {
      setLoading(false)
    }
  }, [token, documentId])

  useEffect(() => {
    if (!hostRef.current || !docReady || !quote?.trim()) return
    const el = highlightDocxQuote(hostRef.current, quote)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [quote, docReady])

  const loadEdits = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/documents/${documentId}/edits`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as { edits?: PendingEdit[] }
    setEdits((data.edits ?? []).filter(e => e.status === 'pending'))
    setActiveIndex(-1)
  }, [token, documentId])

  useEffect(() => {
    void loadDocx()
    void loadEdits()
  }, [loadDocx, loadEdits])

  // Scroll a tracked change into view and pulse it. Uses the w:id already
  // stamped onto the rendered ins/del nodes by loadDocx.
  const scrollToEdit = useCallback((edit: PendingEdit) => {
    const wId = edit.ins_w_id ?? edit.del_w_id
    if (!wId || !hostRef.current) return
    const el = hostRef.current.querySelector<HTMLElement>(`[data-w-id="${wId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('docx-change-active')
    window.setTimeout(() => el.classList.remove('docx-change-active'), 1600)
  }, [])

  const goToChange = (dir: 1 | -1) => {
    if (edits.length === 0) return
    const next = nextChangeIndex(activeIndex, dir, edits.length)
    setActiveIndex(next)
    const edit = edits[next]
    if (edit) scrollToEdit(edit)
  }

  const focusEdit = (index: number) => {
    setActiveIndex(index)
    const edit = edits[index]
    if (edit) scrollToEdit(edit)
  }

  // Resolve a single edit against R2. When reload is false the caller is
  // running a bulk pass and refreshes the document once at the end.
  const resolveOne = useCallback(
    async (editId: string, mode: 'accept' | 'reject'): Promise<boolean> => {
      if (!token) return false
      const res = await fetch(`/api/documents/${documentId}/edits/${editId}/${mode}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to ${mode}`)
      }
      return true
    },
    [token, documentId],
  )

  const resolve = async (editId: string, mode: 'accept' | 'reject') => {
    if (!token || resolvingId || bulkResolving) return
    setResolvingId(editId)
    try {
      await resolveOne(editId, mode)
      await loadDocx()
      await loadEdits()
      onMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not ${mode} edit`)
    } finally {
      setResolvingId(null)
    }
  }

  // Accept/reject every pending change in a single request (one R2 read/write
  // server-side), then re-render the document once. Falls back to a sequential
  // per-edit pass if the batch endpoint is unavailable.
  const resolveAll = async (mode: 'accept' | 'reject') => {
    if (!token || bulkResolving || resolvingId || edits.length === 0) return
    setBulkResolving(mode)
    const total = edits.length
    try {
      let done = 0
      const res = await fetch(`/api/documents/${documentId}/edits/resolve-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { resolved?: number }
        done = data.resolved ?? total
      } else if (res.status === 404 || res.status === 405) {
        // Batch route unavailable — resolve one at a time.
        for (const edit of edits) {
          try {
            await resolveOne(edit.id, mode)
            done += 1
          } catch (e) {
            toast.error(e instanceof Error ? e.message : `Could not ${mode} a change`)
          }
        }
      } else {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Could not ${mode} all changes`)
      }
      await loadDocx()
      await loadEdits()
      onMutated?.()
      if (done > 0) {
        toast.success(`${mode === 'accept' ? 'Accepted' : 'Rejected'} ${done} change${done === 1 ? '' : 's'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not ${mode} all changes`)
    } finally {
      setBulkResolving(null)
    }
  }

  const runRedline = async () => {
    if (!token || !instruction.trim() || redlining) return
    setRedlining(true)
    try {
      const res = await fetch(`/api/documents/${documentId}/edits`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instruction: instruction.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Redline failed')
      toast.success(`Applied ${body.changes?.length ?? 0} tracked change(s)`)
      setInstruction('')
      await loadDocx()
      await loadEdits()
      onMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI redline failed')
    } finally {
      setRedlining(false)
    }
  }

  const busy = resolvingId !== null || bulkResolving !== null

  const redlineBlock = (
    <div className="grid gap-3 border-b border-border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <textarea
        className="min-h-[64px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        placeholder="AI redline instruction (e.g. rename successor trustee Jane Doe to John Smith)"
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
      />
      <Button size="sm" className="h-8 self-start text-xs md:mt-0.5" disabled={redlining || !instruction.trim()} onClick={() => void runRedline()}>
        {redlining ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        AI redline
      </Button>
    </div>
  )

  const editsBlock =
    edits.length > 0 ? (
      <div className={`flex min-h-0 flex-col border-b border-border ${maximized ? 'flex-1' : ''}`}>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <span className="mr-auto text-[11px] font-medium text-muted-foreground">
            {activeIndex >= 0 ? `Change ${activeIndex + 1} of ${edits.length}` : `${edits.length} pending change${edits.length === 1 ? '' : 's'}`}
          </span>
          <Button size="icon" variant="outline" className="h-6 w-6" disabled={busy} onClick={() => goToChange(-1)} aria-label="Previous change" title="Previous change">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="outline" className="h-6 w-6" disabled={busy} onClick={() => goToChange(1)} aria-label="Next change" title="Next change">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={busy} onClick={() => void resolveAll('accept')}>
            {bulkResolving === 'accept' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
            Accept all
          </Button>
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={busy} onClick={() => void resolveAll('reject')}>
            {bulkResolving === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Reject all
          </Button>
        </div>
        <div className={`space-y-2 overflow-y-auto p-3 ${maximized ? 'min-h-0 flex-1' : 'max-h-56'}`}>
          {edits.map((edit, index) => (
            <button
              key={edit.id}
              type="button"
              onClick={() => focusEdit(index)}
              className={`block w-full rounded border p-2 text-left text-xs transition-colors ${
                index === activeIndex ? 'border-accent bg-accent/10' : 'border-border bg-muted/40 hover:bg-muted/70'
              }`}
            >
              {edit.reason ? <p className="mb-1 text-muted-foreground">{edit.reason}</p> : null}
              {edit.deleted_text ? (
                <p>
                  <span className="text-destructive line-through">{edit.deleted_text}</span>
                </p>
              ) : null}
              {edit.inserted_text ? (
                <p>
                  <span className="text-green underline">{edit.inserted_text}</span>
                </p>
              ) : null}
              <div className="mt-1.5 flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 text-[11px]"
                  disabled={busy}
                  onClick={e => {
                    e.stopPropagation()
                    void resolve(edit.id, 'accept')
                  }}
                >
                  {resolvingId === edit.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 text-[11px]"
                  disabled={busy}
                  onClick={e => {
                    e.stopPropagation()
                    void resolve(edit.id, 'reject')
                  }}
                >
                  <X className="h-3 w-3" /> Reject
                </Button>
              </div>
            </button>
          ))}
        </div>
      </div>
    ) : maximized ? (
      <div className="border-b border-border p-3 text-xs text-muted-foreground">No pending AI changes.</div>
    ) : null

  const docBlock = (
    <div className={`relative min-h-0 flex-1 overflow-auto bg-muted/20 p-4 md:p-6 ${maximized ? 'order-1' : 'order-2'}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div
        ref={hostRef}
        style={{ zoom }}
        className="docx-host mx-auto max-w-[820px] rounded-md border border-border bg-card p-4 text-sm text-foreground shadow-sm md:p-8"
      />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{documentName}</p>
          <p className="text-[11px] text-muted-foreground">In-app DOCX review</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-md border border-border px-0.5">
            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={zoom <= 0.6} onClick={() => applyZoom(zoom - 0.1)} aria-label="Zoom out" title="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => applyZoom(1)}
              className="min-w-[3ch] text-center text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={zoom >= 2} onClick={() => applyZoom(zoom + 0.1)} aria-label="Zoom in" title="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={zoom === 1} onClick={() => applyZoom(1)} aria-label="Reset zoom" title="Reset zoom">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {onConvert ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" disabled={converting} onClick={onConvert}>
                  {converting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileType2 className="h-3.5 w-3.5" />}
                  Convert to PDF
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export a shareable PDF, then review and share it with the client.</TooltipContent>
            </Tooltip>
          ) : null}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="Close viewer">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* One stable container in both modes: only the classes change, so the
          imperatively-rendered docx host div is never remounted (which would
          blank the document) when toggling maximize. */}
      <div
        className={
          maximized
            ? 'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1'
            : 'flex min-h-0 flex-1 flex-col'
        }
      >
        {docBlock}
        <div
          className={
            maximized
              ? 'order-2 flex min-h-0 flex-col overflow-hidden border-t border-border lg:border-t-0 lg:border-l'
              : 'order-1 flex flex-col'
          }
        >
          {redlineBlock}
          {editsBlock}
        </div>
      </div>
    </div>
  )
}
