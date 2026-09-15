'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, Download, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

/**
 * What is happening with an agreement after it was sent.
 *
 * The panel deliberately shows when the firm last managed to *ask* the
 * provider, not just what the answer was. "Nothing has happened yet" and "we
 * have not been able to reach the provider since Tuesday" look identical
 * without it, and only one of them needs someone to act.
 */

type ArtifactKind = 'signed_pdf' | 'audit_certificate' | 'combined_evidence'

type StatusView = {
  agreementId: string
  status: string
  provider: string
  externalRequestId: string | null
  sentAt: string | null
  completedAt: string | null
  lastProviderSyncAt: string | null
  providerSyncError: string | null
  providerSyncErrorAt: string | null
  capabilities: { resend: boolean; cancel: boolean; embeddedSigning: boolean; separateAuditCertificate: boolean } | null
  live: boolean
  recipients: Array<{
    id: string
    role: string
    name: string
    email: string
    order: number
    status: string
    sentAt: string | null
    viewedAt: string | null
    signedAt: string | null
    declinedAt: string | null
    lastRemindedAt: string | null
    resendEligible: boolean
  }>
  artifacts: Array<{ kind: ArtifactKind; sha256: string; byteSize: number; mimeType: string; retrievedAt: string }>
}

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  signed_pdf: 'Signed agreement',
  audit_certificate: 'Audit certificate',
  combined_evidence: 'Signed agreement + audit certificate',
}

function when(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

/**
 * Coerce a status response into something safe to render.
 *
 * This panel sits above the drafting workspace, so a response missing a field
 * would otherwise take the whole page down with it — a signing-status panel is
 * not worth losing the agreement editor over. Missing lists read as empty,
 * which renders as "nothing to act on" rather than a blank screen.
 */
function normalize(body: unknown): StatusView {
  const raw = (body ?? {}) as Partial<StatusView>
  return {
    ...(raw as StatusView),
    recipients: Array.isArray(raw.recipients) ? raw.recipients : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    capabilities: raw.capabilities ?? null,
    live: raw.live === true,
  }
}

function recipientTimeline(recipient: StatusView['recipients'][number]): string {
  if (recipient.declinedAt) return `Declined ${when(recipient.declinedAt)}`
  if (recipient.signedAt) return `Signed ${when(recipient.signedAt)}`
  if (recipient.viewedAt) return `Viewed ${when(recipient.viewedAt)}`
  if (recipient.sentAt) return `Sent ${when(recipient.sentAt)}`
  return 'Not yet sent'
}

export function EngagementStatusPanel({ agreementId }: { agreementId: string }) {
  const [view, setView] = useState<StatusView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'refresh' | 'resend' | 'cancel'>(null)
  const [selected, setSelected] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/engagement-agreements/${agreementId}/status`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load status')
      setView(normalize(body))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load status')
    }
  }, [agreementId])

  useEffect(() => { void load() }, [load])

  async function act(
    action: 'refresh' | 'resend' | 'cancel',
    path: string,
    body?: Record<string, unknown>,
  ) {
    setBusy(action)
    setError(null)
    try {
      const response = await fetch(`/api/admin/engagement-agreements/${agreementId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `Could not ${action}`)
      setView(normalize(payload))
      setSelected([])
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action}`)
    } finally {
      setBusy(null)
    }
  }

  async function downloadArtifact(kind: ArtifactKind) {
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/engagement-agreements/${agreementId}/evidence?kind=${encodeURIComponent(kind)}`,
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not fetch the download link')
      window.open(body.url as string, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch the download link')
    }
  }

  async function cancel() {
    const reason = window.prompt('Why is this agreement being cancelled? The client is notified.')
    if (!reason?.trim()) return
    await act('cancel', 'cancel', { confirm: true, reason: reason.trim() })
  }

  if (!view) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">{error ?? 'Loading signing status…'}</p>
      </section>
    )
  }

  const canResend = Boolean(view.capabilities?.resend) && view.live
  const canCancel = Boolean(view.capabilities?.cancel) && view.live
  const eligible = view.recipients.filter(r => r.resendEligible)

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Signing status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Signing status</h2>
          <Badge variant="outline" className="text-[11px]">{view.status}</Badge>
          <Badge variant="outline" className="text-[11px]">{view.provider}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => act('refresh', 'status')}
            disabled={busy !== null}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy === 'refresh' && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => act('resend', 'resend', { recipientIds: selected })}
            disabled={busy !== null || !canResend || selected.length === 0}
            title={canResend ? undefined : 'This provider does not support resending'}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Resend{selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            onClick={cancel}
            disabled={busy !== null || !canCancel}
            title={canCancel ? undefined : 'This provider does not support cancelling'}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground md:grid-cols-4">
        <div><dt className="inline font-medium">Sent </dt><dd className="inline">{when(view.sentAt)}</dd></div>
        <div><dt className="inline font-medium">Completed </dt><dd className="inline">{when(view.completedAt)}</dd></div>
        <div><dt className="inline font-medium">Last checked </dt><dd className="inline">{when(view.lastProviderSyncAt)}</dd></div>
        <div><dt className="inline font-medium">Request </dt><dd className="inline">{view.externalRequestId ?? '—'}</dd></div>
      </dl>

      {(error || view.providerSyncError) && (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error ?? `${view.providerSyncError} (${when(view.providerSyncErrorAt)})`}</span>
        </p>
      )}

      <ul className="divide-y divide-border rounded-md border border-border">
        {view.recipients.map(recipient => (
          <li key={recipient.id} className="flex items-center gap-3 px-3 py-2">
            <Checkbox
              checked={selected.includes(recipient.id)}
              disabled={!recipient.resendEligible || !canResend}
              onCheckedChange={checked => setSelected(prev => (
                checked === true ? [...prev, recipient.id] : prev.filter(id => id !== recipient.id)
              ))}
              aria-label={`Select ${recipient.name} for resend`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {recipient.name} <span className="font-normal text-muted-foreground">({recipient.role})</span>
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{recipient.email}</p>
            </div>
            <div className="text-right">
              <Badge variant="outline" className="text-[10px]">{recipient.status}</Badge>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{recipientTimeline(recipient)}</p>
              {recipient.lastRemindedAt && (
                <p className="text-[10px] text-muted-foreground">Reminded {when(recipient.lastRemindedAt)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {eligible.length === 0 && view.live && (
        <p className="text-[11px] text-muted-foreground">Every recipient has already acted; there is no one to remind.</p>
      )}

      {view.artifacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.artifacts.map(artifact => (
            <Button
              key={artifact.kind}
              type="button" size="sm" variant="outline"
              onClick={() => downloadArtifact(artifact.kind)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {ARTIFACT_LABEL[artifact.kind]}
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}
