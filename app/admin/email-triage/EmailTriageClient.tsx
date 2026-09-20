'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  MailCheck,
  MailSearch,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { DEFAULT_REPLY_SLA_HOURS } from '@/lib/comms/thread'
import type {
  EmailTriageRow,
  TriageClassification,
  TriageScanRow,
} from '@/lib/queries/emailTriage'

interface Props {
  initialRows: EmailTriageRow[]
  initialScan: TriageScanRow | null
  listingTruncated?: boolean
  enabled: boolean
  connected: boolean
  mailbox: string | null
  hasReadScope: boolean
}

const CLASSIFICATION_LABEL: Record<TriageClassification, string> = {
  client: 'Client',
  lead: 'Lead',
  contact: 'Contact',
  possible_lead: 'Possible new lead',
}

const CLASSIFICATION_VARIANT: Record<
  TriageClassification,
  'default' | 'secondary' | 'outline'
> = {
  client: 'default',
  lead: 'secondary',
  contact: 'outline',
  possible_lead: 'outline',
}

function hoursSince(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 3_600_000
}

function waitingLabel(iso: string): string {
  const hours = hoursSince(iso)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** The record this sender belongs to, when Cornerstone knows them. */
function recordHref(row: EmailTriageRow): string | null {
  if (row.matter_id && row.classification === 'client') return `/admin/matters/${row.matter_id}`
  if (row.client_intake_id) return `/admin/crm/opportunities/${row.client_intake_id}`
  return null
}

function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`
}

export function EmailTriageClient({
  initialRows,
  initialScan,
  listingTruncated = false,
  enabled,
  connected,
  mailbox,
  hasReadScope,
}: Props) {
  const token = useAccessToken()
  const [rows, setRows] = useState(initialRows)
  const [scan, setScan] = useState(initialScan)
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const selected = useMemo(
    () => rows.find(row => row.id === selectedId) ?? null,
    [rows, selectedId],
  )

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token])

  const reload = useCallback(async () => {
    const res = await fetch('/api/admin/email-triage', {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({})) as { rows?: EmailTriageRow[]; scan?: TriageScanRow }
    if (!res.ok) return
    setRows(body.rows ?? [])
    setScan(body.scan ?? null)
  }, [authHeaders])

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/admin/email-triage/scan', {
        method: 'POST',
        headers: authHeaders(),
      })
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean
        reason?: string
        queued?: number
        draftsGenerated?: number
        remainingNeedsDraft?: number
        error?: string
      }
      if (!res.ok) {
        toast.error(body.error ?? 'The scan could not run')
        return
      }
      if (body.reason === 'already_running') {
        toast.info('A scan is already running — give it a moment.')
        return
      }
      if (body.reason === 'missing_scope') {
        toast.error('Gmail has not granted read access yet. Reconnect from Settings.')
        return
      }
      if (body.reason === 'disabled') {
        toast.info('Email triage is switched off.')
        return
      }
      await reload()
      toast.success(
        `${body.queued ?? 0} waiting, ${body.draftsGenerated ?? 0} drafted`
        + (body.remainingNeedsDraft ? ` · ${body.remainingNeedsDraft} still to draft` : ''),
      )
    } finally {
      setScanning(false)
    }
  }, [authHeaders, reload])

  const act = useCallback(async (
    row: EmailTriageRow,
    path: string,
    init: RequestInit,
    messages: { success: string; failure: string },
  ) => {
    setBusy(row.id)
    try {
      const res = await fetch(`/api/admin/email-triage/${row.id}${path}`, {
        ...init,
        headers: authHeaders(),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        toast.error(body.error ?? messages.failure)
        await reload()
        return false
      }
      await reload()
      toast.success(messages.success)
      return true
    } finally {
      setBusy(null)
    }
  }, [authHeaders, reload])

  if (!enabled) {
    return (
      <AdminPageShell>
        <PageHeader title="Email triage" eyebrow="Daily" icon={MailSearch} />
        <EmptyState
          icon={MailSearch}
          title="Email triage is switched off"
          description="Nothing is reading the mailbox. Turn it on in firm settings to start scanning."
        />
      </AdminPageShell>
    )
  }

  return (
    <AdminPageShell>
      <PageHeader
        title="Email triage"
        eyebrow="Daily"
        icon={MailSearch}
        description={
          <>
            Client and lead email waiting on a reply
            {mailbox ? <> in <span className="font-medium">{mailbox}</span></> : null}.
            Approving a draft puts it in Gmail — it is never sent from here.
          </>
        }
        actions={
          <Button size="sm" onClick={runScan} disabled={scanning || !hasReadScope}>
            {scanning
              ? <Loader2 className="mr-2 size-3.5 animate-spin" />
              : <RefreshCw className="mr-2 size-3.5" />}
            Refresh
          </Button>
        }
      />

      {!connected && (
        <ConnectionNotice>
          Gmail is not connected, so there is nothing to triage.{' '}
          <Link href="/admin/settings?tab=google" className="font-medium underline underline-offset-2">
            Connect Google
          </Link>
          .
        </ConnectionNotice>
      )}

      {connected && !hasReadScope && (
        <ConnectionNotice>
          This Google connection can send mail but cannot read your inbox, so the queue stays
          empty.{' '}
          <Link href="/admin/settings?tab=google" className="font-medium underline underline-offset-2">
            Reconnect to grant read access
          </Link>
          .
        </ConnectionNotice>
      )}

      {scan && (
        <p className="text-xs text-muted-foreground">
          Last scanned {waitingLabel(scan.started_at)} · {rows.length} waiting
          {scan.error ? ` · last scan reported: ${scan.error}` : ''}
        </p>
      )}

      {listingTruncated && (
        <p className="text-xs text-destructive">
          The last scan reached its thread ceiling, so mail older than the
          threads it read may not be listed here yet. Refresh to let it work
          further back.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={MailCheck}
          title="Nothing is waiting"
          description="No client or lead email needs a reply right now."
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_1fr]">
          <ul className="min-h-0 space-y-2 overflow-y-auto lg:pr-1">
            {rows.map(row => (
              <li key={row.id}>
                <QueueRow
                  row={row}
                  selected={row.id === selectedId}
                  onSelect={() => setSelectedId(row.id)}
                />
              </li>
            ))}
          </ul>

          <div className="min-h-0 overflow-y-auto">
            {selected
              ? (
                <DraftPane
                  key={selected.id}
                  row={selected}
                  busy={busy === selected.id}
                  onPatch={(patch) => setRows(current => current.map(
                    item => (item.id === selected.id ? { ...item, ...patch } : item),
                  ))}
                  onSave={(patch) => act(
                    selected,
                    '',
                    { method: 'PATCH', body: JSON.stringify(patch) },
                    { success: 'Draft saved', failure: 'Could not save the draft' },
                  )}
                  onDraft={() => act(
                    selected,
                    '/draft',
                    { method: 'POST', body: '{}' },
                    { success: 'Draft written', failure: 'Could not draft a reply' },
                  )}
                  onApprove={() => act(
                    selected,
                    '/approve',
                    { method: 'POST', body: '{}' },
                    {
                      success: 'Draft created on the original thread — review and send from Gmail',
                      failure: 'Could not create the Gmail draft',
                    },
                  )}
                  onDismiss={(scope) => act(
                    selected,
                    '/dismiss',
                    { method: 'POST', body: JSON.stringify({ scope }) },
                    {
                      success: scope === 'thread' ? 'Dismissed' : 'Dismissed, and added to the ignore list',
                      failure: 'Could not dismiss',
                    },
                  )}
                />
              )
              : <EmptyState icon={MailSearch} title="Pick a message" />}
          </div>
        </div>
      )}
    </AdminPageShell>
  )
}

function ConnectionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  )
}

function QueueRow({
  row,
  selected,
  onSelect,
}: {
  row: EmailTriageRow
  selected: boolean
  onSelect: () => void
}) {
  // The firm's own reply SLA, reused rather than a second threshold that could
  // drift from the one the rest of the app enforces.
  const overdue = hoursSince(row.received_at) > DEFAULT_REPLY_SLA_HOURS

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? 'border-selected-border bg-selected' : 'border-border bg-card hover:bg-accent'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {row.sender_name || row.sender_email}
        </span>
        <span className={`shrink-0 text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
          {waitingLabel(row.received_at)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-sm">{row.subject || '(no subject)'}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{row.snippet}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={CLASSIFICATION_VARIANT[row.classification]}>
          {CLASSIFICATION_LABEL[row.classification]}
        </Badge>
        {row.status === 'drafted' && <Badge variant="outline">Draft ready</Badge>}
        {row.status === 'approved' && <Badge variant="outline">In Gmail</Badge>}
        {row.status === 'failed' && <Badge variant="destructive">Draft failed</Badge>}
        {row.human_draft_at && (
          // The age is the point, not decoration: it is the difference between
          // a reply being written now, which the model should stay out of, and
          // one abandoned days ago, which it should help with.
          <Badge variant="outline">
            Your draft open in Gmail · {waitingLabel(row.human_draft_at)}
          </Badge>
        )}
      </div>
    </button>
  )
}

function DraftPane({
  row,
  busy,
  onPatch,
  onSave,
  onDraft,
  onApprove,
  onDismiss,
}: {
  row: EmailTriageRow
  busy: boolean
  onPatch: (patch: Partial<EmailTriageRow>) => void
  onSave: (patch: { draftSubject: string; draftBody: string }) => Promise<boolean>
  onDraft: () => Promise<boolean>
  onApprove: () => Promise<boolean>
  onDismiss: (scope: 'thread' | 'sender' | 'domain') => Promise<boolean>
}) {
  const href = recordHref(row)
  const hasDraft = Boolean(row.draft_body?.trim())
  const dirty = useRef(false)

  // Autosave. The attorney edits and clicks away; losing the edit because it
  // was never explicitly saved would be worse than an occasional extra write.
  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => {
      dirty.current = false
      void onSave({ draftSubject: row.draft_subject ?? '', draftBody: row.draft_body ?? '' })
    }, 1200)
    return () => clearTimeout(timer)
  }, [row.draft_subject, row.draft_body, onSave])

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{row.subject || '(no subject)'}</h2>
          <Button variant="ghost" size="sm" asChild>
            <a href={gmailThreadUrl(row.gmail_thread_id)} target="_blank" rel="noreferrer">
              Open in Gmail <ExternalLink className="ml-1.5 size-3" />
            </a>
          </Button>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.sender_name ? `${row.sender_name} · ` : ''}{row.sender_email}
          {row.classification_reason ? ` · ${row.classification_reason}` : ''}
        </p>
        {href && (
          <Link href={href} className="mt-1 inline-block text-xs font-medium underline underline-offset-2">
            Open the Cornerstone record
          </Link>
        )}
      </div>

      <blockquote className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {row.snippet}
      </blockquote>

      {row.draft_error && (
        <ConnectionNotice>{row.draft_error}</ConnectionNotice>
      )}

      {hasDraft ? (
        <div className="space-y-2">
          <Input
            value={row.draft_subject ?? ''}
            onChange={event => {
              dirty.current = true
              onPatch({ draft_subject: event.target.value })
            }}
            aria-label="Reply subject"
          />
          <Textarea
            value={row.draft_body ?? ''}
            onChange={event => {
              dirty.current = true
              onPatch({ draft_body: event.target.value })
            }}
            aria-label="Reply body"
            className="min-h-[280px] font-mono text-xs"
          />
        </div>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No draft yet"
          description="Generate one, or answer this in Gmail."
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Never "Send" and never "Approve" on its own. The most dangerous
            mistake this page could make is leaving the attorney unsure whether
            something was sent, so the button says exactly what it does. */}
        <Button size="sm" onClick={onApprove} disabled={busy || !hasDraft}>
          {busy ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
          Create Gmail draft
        </Button>
        <Button size="sm" variant="outline" onClick={onDraft} disabled={busy}>
          <Sparkles className="mr-1.5 size-3.5" />
          {hasDraft ? 'Regenerate' : 'Draft a reply'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss('thread')} disabled={busy}>
          <Trash2 className="mr-1.5 size-3.5" />
          Dismiss
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss('sender')} disabled={busy}>
          Never this sender
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss('domain')} disabled={busy}>
          Never this domain
        </Button>
      </div>

      {row.status === 'approved' && row.gmail_draft_message_id && (
        <p className="text-xs text-muted-foreground">
          <a
            href={`https://mail.google.com/mail/u/0/#drafts/${row.gmail_draft_message_id}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            Open the draft in Gmail
          </a>{' '}
          to review and send it.
        </p>
      )}
    </div>
  )
}
