'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { highlightDocxQuote } from '@/lib/highlightDocxQuote'
import { Button } from '@/components/ui/button'

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
  onClose: () => void
  onMutated?: () => void
}

export function DocxViewerPanel({
  documentId,
  documentName,
  quote,
  onClose,
  onMutated,
}: DocxViewerPanelProps) {
  const token = useAccessToken()
  const hostRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [docReady, setDocReady] = useState(false)
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [redlining, setRedlining] = useState(false)

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
  }, [token, documentId])

  useEffect(() => {
    void loadDocx()
    void loadEdits()
  }, [loadDocx, loadEdits])

  const resolve = async (editId: string, mode: 'accept' | 'reject') => {
    if (!token || resolvingId) return
    setResolvingId(editId)
    try {
      const res = await fetch(`/api/documents/${documentId}/edits/${editId}/${mode}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to ${mode}`)
      }
      await loadDocx()
      await loadEdits()
      onMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not ${mode} edit`)
    } finally {
      setResolvingId(null)
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{documentName}</p>
          <p className="text-[11px] text-muted-foreground">In-app DOCX review</p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close viewer">
          <X className="h-4 w-4" />
        </Button>
      </div>

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

      {edits.length > 0 && (
        <div className="max-h-36 space-y-2 overflow-y-auto border-b border-border p-3">
          {edits.map(edit => (
            <div key={edit.id} className="rounded border border-border bg-muted/40 p-2 text-xs">
              {edit.reason ? <p className="mb-1 text-muted-foreground">{edit.reason}</p> : null}
              {edit.deleted_text ? (
                <p>
                  <span className="text-destructive line-through">{edit.deleted_text}</span>
                </p>
              ) : null}
              {edit.inserted_text ? (
                <p>
                  <span className="text-emerald-700 underline">{edit.inserted_text}</span>
                </p>
              ) : null}
              <div className="mt-1.5 flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 text-[11px]"
                  disabled={resolvingId === edit.id}
                  onClick={() => void resolve(edit.id, 'accept')}
                >
                  <Check className="h-3 w-3" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 text-[11px]"
                  disabled={resolvingId === edit.id}
                  onClick={() => void resolve(edit.id, 'reject')}
                >
                  <X className="h-3 w-3" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto bg-muted/20 p-4 md:p-6">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <div ref={hostRef} className="docx-host mx-auto max-w-[820px] rounded-md bg-background p-4 text-sm shadow-sm md:p-8" />
      </div>
    </div>
  )
}
