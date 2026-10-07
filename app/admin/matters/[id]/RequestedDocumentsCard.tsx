'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, FileCheck2, ListChecks, Loader2, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { summariseDocumentRequests, type DocumentRequest } from '@/lib/documentRequests/model'
import { REQUEST_SECTION_LABELS } from '@/lib/documentRequests/probateSet'
import { ProbateRequestListPanel } from './ProbateRequestListPanel'

interface RequestedDocumentsCardProps {
  matterId: string
  /** Called after a request changes, so the Documents list can refresh its badges. */
  onChanged?: () => void | Promise<void>
  /** A probate matter, which offers the standard probate document list. */
  probate?: boolean
}

const STATUS_LABEL: Record<DocumentRequest['status'], { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  requested: { label: 'Requested', variant: 'outline' },
  received: { label: 'Received', variant: 'default' },
  accepted: { label: 'Accepted', variant: 'secondary' },
  waived: { label: 'Waived', variant: 'secondary' },
}

const SOURCE_LABEL: Record<DocumentRequest['source'], string> = {
  staff: '',
  meeting_notes: 'from the meeting notes',
  automation: 'from an automation',
}

/**
 * What the firm has asked the client to send, and what has arrived. The list
 * the portal shows, seen from the firm's side: add a request, accept what came
 * in, waive what is no longer needed.
 */
export function RequestedDocumentsCard({ matterId, onChanged, probate = false }: RequestedDocumentsCardProps) {
  const token = useAccessToken()
  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [saving, setSaving] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const closeList = useCallback(() => setListOpen(false), [])

  const headers = useCallback(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiRequest<{ requests: DocumentRequest[] }>(`/api/admin/matters/${matterId}/document-requests`, { headers: headers() })
      setRequests(result.requests ?? [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Requests are unavailable.')
    } finally {
      setLoading(false)
    }
  }, [token, matterId, headers])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!token || !title.trim()) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/matters/${matterId}/document-requests`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, dueOn: dueOn || null }),
      }, 'Could not create the request')
      toast.success('Request added; the client will see it in their portal')
      setTitle('')
      setDescription('')
      setDueOn('')
      setAdding(false)
      await load()
      await onChanged?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not create the request')
    } finally {
      setSaving(false)
    }
  }

  async function decide(request: DocumentRequest, decision: 'accept' | 'waive' | 'reopen') {
    if (!token) return
    setBusyId(request.id)
    try {
      await apiRequest(`/api/admin/matters/${matterId}/document-requests/${request.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ decision }),
      }, 'Could not update the request')
      await load()
      await onChanged?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not update the request')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(request: DocumentRequest) {
    if (!token) return
    setBusyId(request.id)
    try {
      await apiRequest(`/api/admin/matters/${matterId}/document-requests/${request.id}`, {
        method: 'DELETE',
        headers: headers(),
      }, 'Could not remove the request')
      await load()
      await onChanged?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not remove the request')
    } finally {
      setBusyId(null)
    }
  }

  const summary = summariseDocumentRequests(requests)

  return (
    <section className="rounded-lg border border-border bg-card" data-testid="requested-documents">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Requested from the client</h3>
          <p className="text-xs text-muted-foreground">
            {requests.length === 0
              ? 'Nothing asked for yet. A request shows in the client’s portal with its own upload.'
              : `${summary.awaitingClient} outstanding · ${summary.awaitingStaff} to review · ${summary.accepted} accepted`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {probate && (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { setAdding(false); setListOpen(current => !current) }}>
              <ListChecks className="h-3.5 w-3.5" />
              Ask for the probate documents
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { setListOpen(false); setAdding(current => !current) }}>
            <Plus className="h-3.5 w-3.5" />
            Request a document
          </Button>
        </div>
      </div>

      {listOpen && (
        <ProbateRequestListPanel
          matterId={matterId}
          onClose={closeList}
          onSent={async () => { await load(); await onChanged?.() }}
        />
      )}

      {adding && (
        <form
          className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-[1fr_auto]"
          onSubmit={event => { event.preventDefault(); void add() }}
        >
          <div className="grid gap-2">
            <div>
              <Label htmlFor="request-title" className="text-xs">What do you need?</Label>
              <Input id="request-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="The deed to the lake house" maxLength={160} required />
            </div>
            <div>
              <Label htmlFor="request-description" className="text-xs">Anything the client should know (optional)</Label>
              <Input id="request-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="A photo of the recorded deed is fine." maxLength={1000} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <Label htmlFor="request-due" className="text-xs">Due (optional)</Label>
              <Input id="request-due" type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={saving || !title.trim()} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Ask the client
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void load()}>Retry</Button></p>
      )}
      {loading && !error && <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>}
      {!loading && !error && requests.length > 0 && (
        <ul className="divide-y divide-border/60">
          {requests.map(request => {
            const status = STATUS_LABEL[request.status]
            const busy = busyId === request.id
            const source = SOURCE_LABEL[request.source]
            return (
              <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{request.title}</p>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  {request.description && <p className="mt-0.5 text-xs text-muted-foreground">{request.description}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />asked {request.requestedAt.slice(0, 10)}{source ? ` ${source}` : ''}</span>
                    {request.section && <span>· {REQUEST_SECTION_LABELS[request.section]}</span>}
                    {request.dueOn && <span>· due {request.dueOn}</span>}
                    {request.receivedAt && <span className="inline-flex items-center gap-1">· <FileCheck2 className="size-3" aria-hidden />received {request.receivedAt.slice(0, 10)}</span>}
                    {request.waivedReason && <span>· {request.waivedReason}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {request.status === 'received' && (
                    <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => void decide(request, 'accept')}>
                      <CheckCircle2 className="size-3.5" />
                      Accept
                    </Button>
                  )}
                  {(request.status === 'requested' || request.status === 'received') && (
                    <Button type="button" size="sm" variant="ghost" className="gap-1" disabled={busy} onClick={() => void decide(request, 'waive')}>
                      <XCircle className="size-3.5" />
                      Waive
                    </Button>
                  )}
                  {(request.status === 'accepted' || request.status === 'waived') && (
                    <Button type="button" size="sm" variant="ghost" className="gap-1" disabled={busy} onClick={() => void decide(request, 'reopen')}>
                      <RotateCcw className="size-3.5" />
                      Ask again
                    </Button>
                  )}
                  {request.status === 'requested' && (
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove request ${request.title}`} disabled={busy} onClick={() => void remove(request)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
