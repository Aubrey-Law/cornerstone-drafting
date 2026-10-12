'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  ListTodo,
  Loader2,
  MailCheck,
  MailSearch,
  RefreshCw,
  Send,
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
import { useConfirm } from '@/components/useConfirm'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { DEFAULT_REPLY_SLA_HOURS } from '@/lib/comms/thread'
import { triageLabelName } from '@/lib/emailTriage/labels'
import type {
  EmailTriageRow,
  TriageClassification,
  TriageQueueView,
  TriageScanRow,
} from '@/lib/queries/emailTriage'

interface Props {
  initialRows: EmailTriageRow[]
  initialScan: TriageScanRow | null
  listingTruncated?: boolean
  initialView?: TriageQueueView
  enabled: boolean
  archiveNonClient?: boolean
  connected: boolean
  mailbox: string | null
  hasReadScope: boolean
}

const QUEUE_VIEWS: { id: TriageQueueView; label: string }[] = [
  { id: 'all', label: 'All waiting' },
  { id: 'client', label: 'Clients' },
  { id: 'lead', label: 'Leads' },
  { id: 'contact', label: 'Contacts' },
  { id: 'possible_lead', label: 'Possible leads' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'needs_draft', label: 'Needs draft' },
  { id: 'drafted', label: 'Drafted' },
  { id: 'failed', label: 'Failed' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'follow_up', label: 'Follow-ups due' },
]

function snoozePresetIso(kind: '1h' | 'tonight' | 'tomorrow' | 'week'): string {
  const now = new Date()
  if (kind === '1h') return new Date(now.getTime() + 3_600_000).toISOString()
  if (kind === 'week') return new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const target = new Date(now)
  if (kind === 'tonight') {
    target.setHours(20, 0, 0, 0)
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  } else {
    target.setDate(target.getDate() + 1)
    target.setHours(9, 0, 0, 0)
  }
  return target.toISOString()
}

function followUpPresetIso(kind: '2d' | '1w'): string {
  const days = kind === '2d' ? 2 : 7
  return new Date(Date.now() + days * 86_400_000).toISOString()
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

const REPLY_BODY_ID = 'triage-reply-body'

function queueRowId(id: string): string {
  return `triage-row-${id}`
}

/** One message of the thread, as the message route returns it. */
interface ThreadMessage {
  id: string
  from: { name: string | null; email: string }
  receivedAt: string
  bodyText: string
  outbound: boolean
}

type ThreadResult =
  | { ok: true; messages: ThreadMessage[] }
  | { ok: false; error: string }

export function EmailTriageClient({
  initialRows,
  initialScan,
  listingTruncated = false,
  initialView = 'all',
  enabled,
  archiveNonClient = true,
  connected,
  mailbox,
  hasReadScope,
}: Props) {
  const token = useAccessToken()
  const { confirm, confirmDialog } = useConfirm()
  const [view, setView] = useState<TriageQueueView>(initialView)
  const [rows, setRows] = useState(initialRows)
  const [scan, setScan] = useState(initialScan)
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [createdTaskHref, setCreatedTaskHref] = useState<string | null>(null)
  // Read inside reload() to find where the selection sat before the queue
  // changed, without making reload depend on rows.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    setCreatedTaskHref(null)
  }, [selectedId])

  const selected = useMemo(
    () => rows.find(row => row.id === selectedId) ?? null,
    [rows, selectedId],
  )

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token])

  const reload = useCallback(async (nextView: TriageQueueView = view) => {
    const res = await fetch(`/api/admin/email-triage?view=${encodeURIComponent(nextView)}`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({})) as { rows?: EmailTriageRow[]; scan?: TriageScanRow }
    if (!res.ok) return
    const nextRows = body.rows ?? []
    // Dismissing or approving drops the row from the queue. Open the one that
    // took its place rather than leaving "Pick a message", so working the
    // queue is one click per email instead of two.
    setSelectedId(current => {
      if (current && nextRows.some(row => row.id === current)) return current
      const previousIndex = rowsRef.current.findIndex(row => row.id === current)
      const index = Math.min(Math.max(previousIndex, 0), nextRows.length - 1)
      return nextRows[index]?.id ?? null
    })
    setRows(nextRows)
    setScan(body.scan ?? null)
  }, [authHeaders, view])

  const changeView = useCallback((next: TriageQueueView) => {
    setView(next)
    void reload(next)
  }, [reload])

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
        repliesSent?: number
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
        + (body.repliesSent ? ` · ${body.repliesSent} sent for you` : '')
        + (body.remainingNeedsDraft ? ` · ${body.remainingNeedsDraft} still to draft` : ''),
      )
    } finally {
      setScanning(false)
    }
  }, [authHeaders, reload])

  const loadThread = useCallback(async (id: string): Promise<ThreadResult> => {
    try {
      const res = await fetch(`/api/admin/email-triage/${id}/message`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({})) as {
        messages?: ThreadMessage[]
        gone?: boolean
        error?: string
      }
      if (!res.ok) return { ok: false, error: body.error ?? 'Gmail did not return the thread' }
      if (body.gone) return { ok: false, error: 'This thread is no longer in Gmail' }
      return { ok: true, messages: body.messages ?? [] }
    } catch {
      return { ok: false, error: 'Gmail did not return the thread' }
    }
  }, [authHeaders])

  const act = useCallback(async (
    row: EmailTriageRow,
    path: string,
    init: RequestInit,
    messages: {
      success: string | ((body: Record<string, unknown>) => string)
      failure: string
    },
  ) => {
    setBusy(row.id)
    try {
      const res = await fetch(`/api/admin/email-triage/${row.id}${path}`, {
        ...init,
        headers: authHeaders(),
      })
      const body = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
      if (!res.ok) {
        toast.error(body.error ?? messages.failure)
        await reload()
        return false
      }
      await reload()
      toast.success(typeof messages.success === 'function' ? messages.success(body) : messages.success)
      return true
    } finally {
      setBusy(null)
    }
  }, [authHeaders, reload])

  const draftSelected = useCallback(() => {
    if (!selected) return Promise.resolve(false)
    return act(
      selected,
      '/draft',
      { method: 'POST', body: '{}' },
      { success: 'Draft written', failure: 'Could not draft a reply' },
    )
  }, [act, selected])

  const dismissSelected = useCallback((scope: 'thread' | 'sender' | 'domain') => {
    if (!selected) return Promise.resolve(false)
    return act(
      selected,
      '/dismiss',
      { method: 'POST', body: JSON.stringify({ scope }) },
      {
        success: body => {
          if (scope === 'thread') return 'Dismissed'
          const cleanup = body.gmailCleanup as { draftsDeleted?: number; error?: string | null } | null | undefined
          if (cleanup?.error) {
            toast.warning('Could not finish tidying Gmail for this sender', { description: cleanup.error })
            return 'Dismissed, and added to the ignore list'
          }
          const drafts = cleanup?.draftsDeleted ?? 0
          return `Dismissed and ignored. Client/Lead labels removed${drafts ? `, ${drafts} Gmail draft${drafts === 1 ? '' : 's'} deleted` : ''}.`
        },
        failure: 'Could not dismiss',
      },
    )
  }, [act, selected])

  const patchSelected = useCallback(async (patch: Record<string, unknown>, success: string) => {
    if (!selected) return false
    return act(
      selected,
      '',
      { method: 'PATCH', body: JSON.stringify(patch) },
      { success, failure: 'Could not update the thread' },
    )
  }, [act, selected])

  const snoozeSelected = useCallback(async (until: string) => {
    return patchSelected({ snoozedUntil: until }, 'Snoozed — hidden until then')
  }, [patchSelected])

  const clearSnoozeSelected = useCallback(async () => {
    return patchSelected({ snoozedUntil: null }, 'Snooze cleared')
  }, [patchSelected])

  const followUpSelected = useCallback(async (at: string, note?: string) => {
    const patch: Record<string, unknown> = { followUpAt: at }
    if (typeof note === 'string') patch.followUpNote = note
    return patchSelected(patch, 'Follow-up reminder set')
  }, [patchSelected])

  const clearFollowUpSelected = useCallback(async () => {
    return patchSelected({ followUpAt: null }, 'Follow-up cleared')
  }, [patchSelected])

  const quietPatchSelected = useCallback(async (patch: Record<string, unknown>) => {
    if (!selected) return false
    setBusy(selected.id)
    try {
      const res = await fetch(`/api/admin/email-triage/${selected.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; row?: EmailTriageRow }
      if (!res.ok) {
        toast.error(body.error ?? 'Could not update the thread')
        await reload()
        return false
      }
      if (body.row) {
        setRows(current => current.map(item => (item.id === body.row!.id ? body.row! : item)))
      }
      return true
    } finally {
      setBusy(null)
    }
  }, [authHeaders, reload, selected])

  const createTaskSelected = useCallback(async () => {
    if (!selected) return false
    setBusy(selected.id)
    try {
      const res = await fetch(`/api/admin/email-triage/${selected.id}/task`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      })
      const body = await res.json().catch(() => ({})) as {
        error?: string
        href?: string
      }
      if (!res.ok) {
        toast.error(body.error ?? 'Could not create the task')
        await reload()
        return false
      }
      const href = typeof body.href === 'string' ? body.href : '/admin/tasks'
      setCreatedTaskHref(href)
      toast.success('Task created from this email', {
        duration: 12_000,
        description: 'It is on the matter or lead Tasks tab when linked.',
        action: {
          label: 'Open task',
          onClick: () => { window.location.href = href },
        },
      })
      await reload()
      return true
    } finally {
      setBusy(null)
    }
  }, [authHeaders, reload, selected])

  // Sends exactly what the editor shows — the subject and body travel with the
  // request, so an edit the autosave has not reached yet is the one that goes.
  const sendSelected = useCallback(async () => {
    if (!selected) return false
    const recipient = selected.sender_name
      ? `${selected.sender_name} <${selected.sender_email}>`
      : selected.sender_email
    const confirmed = await confirm({
      title: `Send this reply to ${recipient}?`,
      body: 'It goes out now from your Gmail, on the original thread, exactly as shown here. '
        + 'A sent email cannot be taken back.'
        + (selected.gmail_draft_id ? ' The Gmail draft created earlier will be removed.' : ''),
      confirmLabel: 'Send reply',
    })
    if (!confirmed) return false
    return act(
      selected,
      '/send',
      {
        method: 'POST',
        body: JSON.stringify({
          draftSubject: selected.draft_subject ?? '',
          draftBody: selected.draft_body ?? '',
        }),
      },
      {
        success: body => {
          // The reply is out and the row has left the queue, so anything that
          // went wrong afterwards has to be said now or not at all.
          const notices = Array.isArray(body.notices) ? body.notices : []
          for (const notice of notices) {
            if (typeof notice === 'string') toast.warning(notice)
          }
          return `Reply sent to ${selected.sender_email}`
        },
        failure: 'The reply was not sent',
      },
    )
  }, [act, confirm, selected])

  // J/K to move, R to reply, D to dismiss — the same letters the Today queue
  // uses for moving, so working the mailbox needs no mouse. Only the harmless
  // "Dismiss" gets a key: nothing that touches Gmail or the ignore list does.
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Never steal keys from inputs, dialogs or the rail.
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], aside')) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (rows.length === 0) return

      const index = rows.findIndex(row => row.id === selectedId)
      const move = (delta: number) => {
        const next = Math.max(0, Math.min(rows.length - 1, (index === -1 ? 0 : index + delta)))
        setSelectedId(rows[next].id)
        document.getElementById(queueRowId(rows[next].id))?.scrollIntoView({ block: 'nearest' })
      }

      switch (event.key) {
        case 'j': case 'J': case 'ArrowDown':
          event.preventDefault()
          move(1)
          break
        case 'k': case 'K': case 'ArrowUp':
          event.preventDefault()
          move(-1)
          break
        case 'r': case 'R':
          if (!selected || busy) break
          event.preventDefault()
          if (selected.draft_body?.trim()) document.getElementById(REPLY_BODY_ID)?.focus()
          else void draftSelected()
          break
        case 'd': case 'D':
          if (!selected || busy) break
          event.preventDefault()
          void dismissSelected('thread')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [busy, dismissSelected, draftSelected, rows, selected, selectedId])

  if (!enabled) {
    return (
      <AdminPageShell>
        <PageHeader title="Mail Desk" eyebrow="Daily" icon={MailSearch} />
        <EmptyState
          icon={MailSearch}
          title="Mail Desk is switched off"
          description="Nothing is reading the mailbox. Turn scanning on in Settings → Email."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/admin/settings?tab=email">Open Settings → Email</Link>
            </Button>
          }
        />
      </AdminPageShell>
    )
  }

  return (
    // Bounded to the content area on desktop so the queue and the draft scroll
    // independently: an email at the bottom of the list no longer pushes the
    // draft off screen.
    <AdminPageShell className="lg:h-full">
      <PageHeader
        title="Mail Desk"
        eyebrow="Daily"
        icon={MailSearch}
        description={
          <>
            Matter-aware email queue
            {mailbox ? <> for <span className="font-medium">{mailbox}</span></> : null}.
            Non-client and handled mail is labelled
            {archiveNonClient ? ' and archived out of the Gmail Inbox' : ' in Gmail (Inbox left alone)'}.
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

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Mail Desk views">
        {QUEUE_VIEWS.map(item => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={view === item.id ? 'default' : 'outline'}
            role="tab"
            aria-selected={view === item.id}
            onClick={() => changeView(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {(scan || rows.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {scan
            ? (
              <p className="text-xs text-muted-foreground">
                Last scanned {waitingLabel(scan.started_at)} · {rows.length} in this view
                {scan.error ? ` · last scan reported: ${scan.error}` : ''}
              </p>
            )
            : <span />}
          {rows.length > 0 && (
            <span className="hidden items-center gap-1.5 text-micro text-muted-foreground lg:inline-flex">
              <kbd className="rounded border border-border bg-muted px-1">J</kbd>
              <kbd className="rounded border border-border bg-muted px-1">K</kbd>
              move
              <kbd className="rounded border border-border bg-muted px-1">R</kbd>
              reply
              <kbd className="rounded border border-border bg-muted px-1">D</kbd>
              dismiss
              <kbd className="rounded border border-border bg-muted px-1">Esc</kbd>
              leave the reply
            </span>
          )}
        </div>
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
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <ul className="min-h-0 space-y-2 overflow-y-auto overscroll-contain lg:pr-1">
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

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {selected
              ? (
                <DraftPane
                  key={selected.id}
                  row={selected}
                  busy={busy === selected.id}
                  createdTaskHref={createdTaskHref}
                  onPatch={(patch) => setRows(current => current.map(
                    item => (item.id === selected.id ? { ...item, ...patch } : item),
                  ))}
                  onSave={(patch) => act(
                    selected,
                    '',
                    { method: 'PATCH', body: JSON.stringify(patch) },
                    { success: 'Draft saved', failure: 'Could not save the draft' },
                  )}
                  onQuietSave={quietPatchSelected}
                  loadThread={loadThread}
                  onDraft={draftSelected}
                  onApprove={() => act(
                    selected,
                    '/approve',
                    { method: 'POST', body: '{}' },
                    {
                      success: body => {
                        const base = 'Draft created on the original thread — review and send from Gmail'
                        if (typeof body.labelError === 'string') {
                          toast.warning('The Gmail label could not be applied', { description: body.labelError })
                          return base
                        }
                        return typeof body.label === 'string' ? `${base}. Labeled ${body.label}.` : base
                      },
                      failure: 'Could not create the Gmail draft',
                    },
                  )}
                  onSend={sendSelected}
                  onDismiss={dismissSelected}
                  onSnooze={snoozeSelected}
                  onClearSnooze={clearSnoozeSelected}
                  onFollowUp={followUpSelected}
                  onClearFollowUp={clearFollowUpSelected}
                  onCreateTask={createTaskSelected}
                />
              )
              : <EmptyState icon={MailSearch} title="Pick a message" />}
          </div>
        </div>
      )}
      {confirmDialog}
    </AdminPageShell>
  )
}

/**
 * The Gmail label an approved row's thread carries. A failed labelling leaves
 * its notice in `draft_error`, so a row carrying one claims no label.
 */
function appliedLabel(row: EmailTriageRow): string | null {
  if (row.status !== 'approved' || row.draft_error) return null
  return triageLabelName(row.classification)
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
      id={queueRowId(row.id)}
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
      {row.thread_note?.trim() && (
        <p className="mt-0.5 truncate text-xs text-foreground/80">
          Note · {row.thread_note.trim()}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={CLASSIFICATION_VARIANT[row.classification]}>
          {CLASSIFICATION_LABEL[row.classification]}
        </Badge>
        {row.status === 'drafted' && <Badge variant="outline">Draft ready</Badge>}
        {row.status === 'approved' && (
          <Badge variant="outline">
            In Gmail{appliedLabel(row) ? ` · ${appliedLabel(row)}` : ''}
          </Badge>
        )}
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
  createdTaskHref,
  loadThread,
  onPatch,
  onSave,
  onQuietSave,
  onDraft,
  onApprove,
  onSend,
  onDismiss,
  onSnooze,
  onClearSnooze,
  onFollowUp,
  onClearFollowUp,
  onCreateTask,
}: {
  row: EmailTriageRow
  busy: boolean
  createdTaskHref: string | null
  loadThread: (id: string) => Promise<ThreadResult>
  onPatch: (patch: Partial<EmailTriageRow>) => void
  onSave: (patch: { draftSubject: string; draftBody: string }) => Promise<boolean>
  onQuietSave: (patch: Record<string, unknown>) => Promise<boolean>
  onDraft: () => Promise<boolean>
  onApprove: () => Promise<boolean>
  onSend: () => Promise<boolean>
  onDismiss: (scope: 'thread' | 'sender' | 'domain') => Promise<boolean>
  onSnooze: (until: string) => Promise<boolean>
  onClearSnooze: () => Promise<boolean>
  onFollowUp: (at: string, note?: string) => Promise<boolean>
  onClearFollowUp: () => Promise<boolean>
  onCreateTask: () => Promise<boolean>
}) {
  const href = recordHref(row)
  const hasDraft = Boolean(row.draft_body?.trim())
  const dirty = useRef(false)
  const noteDirty = useRef(false)
  const followUpNoteDirty = useRef(false)
  const snoozed = Boolean(row.snoozed_until && Date.parse(row.snoozed_until) > Date.now())

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

  useEffect(() => {
    if (!noteDirty.current) return
    const timer = setTimeout(() => {
      noteDirty.current = false
      void onQuietSave({ threadNote: row.thread_note ?? '' })
    }, 900)
    return () => clearTimeout(timer)
  }, [row.thread_note, onQuietSave])

  useEffect(() => {
    if (!followUpNoteDirty.current) return
    const timer = setTimeout(() => {
      followUpNoteDirty.current = false
      void onQuietSave({ followUpNote: row.follow_up_note ?? '' })
    }, 900)
    return () => clearTimeout(timer)
  }, [row.follow_up_note, onQuietSave])

  return (
    // Fills the column on desktop: the header and buttons keep their size, the
    // thread takes what it needs up to a cap, and the reply box gets the rest.
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 lg:h-full lg:overflow-y-auto">
      <div className="shrink-0">
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
        {(row.gmail_sort_label || snoozed || row.follow_up_at) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {row.gmail_sort_label
              ? <>Also sorted in Gmail as <span className="font-medium">{row.gmail_sort_label}</span>. </>
              : null}
            {snoozed && row.snoozed_until
              ? <>Snoozed until {new Date(row.snoozed_until).toLocaleString()}. </>
              : null}
            {row.follow_up_at
              ? <>Follow up {Date.parse(row.follow_up_at) <= Date.now() ? 'due' : 'at'}{' '}
                {new Date(row.follow_up_at).toLocaleString()}
                {row.follow_up_note?.trim() ? ` — ${row.follow_up_note.trim()}` : ''}.
                </>
              : null}
          </p>
        )}
      </div>

      {createdTaskHref && (
        <p
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground"
        >
          Task created.{' '}
          <a href={createdTaskHref} className="font-medium underline underline-offset-2">
            Open task
          </a>
        </p>
      )}

      <div className="shrink-0 space-y-1.5">
        <label htmlFor="mail-desk-thread-note" className="text-xs font-medium text-muted-foreground">
          Attorney note
        </label>
        <Textarea
          id="mail-desk-thread-note"
          value={row.thread_note ?? ''}
          onChange={event => {
            noteDirty.current = true
            onPatch({ thread_note: event.target.value })
          }}
          placeholder="Private note on this thread (not sent)"
          rows={2}
          className="resize-none text-xs"
          disabled={busy}
        />
      </div>

      <ThreadView row={row} loadThread={loadThread} />

      {row.draft_error && (
        <ConnectionNotice>{row.draft_error}</ConnectionNotice>
      )}

      {hasDraft ? (
        <div className="flex min-h-[240px] flex-1 flex-col gap-2">
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
            onKeyDown={event => {
              // Hands the keyboard back to the queue shortcuts.
              if (event.key === 'Escape') event.currentTarget.blur()
            }}
            id={REPLY_BODY_ID}
            aria-label="Reply body"
            className="min-h-[200px] flex-1 resize-none font-mono text-xs field-sizing-fixed"
          />
        </div>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No draft yet"
          description="Generate one, or answer this in Gmail."
        />
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Never a bare "Approve". The most dangerous mistake this page could
            make is leaving the attorney unsure whether something was sent, so
            each button says exactly what it does, and the one that sends asks
            first. */}
        <Button size="sm" onClick={onSend} disabled={busy || !hasDraft || row.status === 'drafting'}>
          {busy
            ? <Loader2 className="mr-2 size-3.5 animate-spin" />
            : <Send className="mr-1.5 size-3.5" />}
          Send reply
        </Button>
        <Button size="sm" variant="outline" onClick={onApprove} disabled={busy || !hasDraft}>
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
        <Button size="sm" variant="ghost" onClick={() => void onCreateTask()} disabled={busy}>
          <ListTodo className="mr-1.5 size-3.5" />
          Create task
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss('sender')} disabled={busy}>
          Never this sender
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss('domain')} disabled={busy}>
          Never this domain
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden /> Snooze
        </span>
        {snoozed ? (
          <Button size="sm" variant="outline" onClick={() => void onClearSnooze()} disabled={busy}>
            Clear snooze
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => void onSnooze(snoozePresetIso('1h'))} disabled={busy}>1h</Button>
            <Button size="sm" variant="outline" onClick={() => void onSnooze(snoozePresetIso('tonight'))} disabled={busy}>Tonight</Button>
            <Button size="sm" variant="outline" onClick={() => void onSnooze(snoozePresetIso('tomorrow'))} disabled={busy}>Tomorrow</Button>
            <Button size="sm" variant="outline" onClick={() => void onSnooze(snoozePresetIso('week'))} disabled={busy}>Next week</Button>
          </>
        )}
        <span className="ml-2 text-xs text-muted-foreground">Follow-up</span>
        {row.follow_up_at ? (
          <Button size="sm" variant="outline" onClick={() => void onClearFollowUp()} disabled={busy}>
            Clear follow-up
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => void onFollowUp(followUpPresetIso('2d'))} disabled={busy}>In 2 days</Button>
            <Button size="sm" variant="outline" onClick={() => void onFollowUp(followUpPresetIso('1w'))} disabled={busy}>In 1 week</Button>
          </>
        )}
      </div>

      {row.follow_up_at && (
        <div className="shrink-0 space-y-1.5">
          <label htmlFor="mail-desk-follow-up-note" className="text-xs font-medium text-muted-foreground">
            Follow-up note
          </label>
          <Textarea
            id="mail-desk-follow-up-note"
            value={row.follow_up_note ?? ''}
            onChange={event => {
              followUpNoteDirty.current = true
              onPatch({ follow_up_note: event.target.value })
            }}
            placeholder="Why we are waiting (optional)"
            rows={2}
            className="resize-none text-xs"
            disabled={busy}
          />
        </div>
      )}

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
          {appliedLabel(row) && <> Labeled <span className="font-medium">{appliedLabel(row)}</span>.</>}
        </p>
      )}
    </div>
  )
}

/**
 * The thread itself, read live from Gmail — bodies are never stored, so this
 * is a fetch per opened row. Falls back to the stored snippet when Gmail cannot
 * answer, so the page still says what the email was about.
 */
function ThreadView({
  row,
  loadThread,
}: {
  row: EmailTriageRow
  loadThread: (id: string) => Promise<ThreadResult>
}) {
  const [result, setResult] = useState<ThreadResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadThread(row.id).then(next => {
      if (!cancelled) setResult(next)
    })
    return () => { cancelled = true }
  }, [loadThread, row.id])

  const messages = result?.ok ? result.messages : []
  const listRef = useRef<HTMLDivElement>(null)

  // The newest message is the one being answered; start the view there. Set on
  // the list itself — scrollIntoView would also scroll the columns around it.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  if (!result || !result.ok || messages.length === 0) {
    return (
      <div className="shrink-0 space-y-1">
        <blockquote className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {row.snippet}
        </blockquote>
        {!result && (
          <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Loading the full thread from Gmail…
          </p>
        )}
        {result && !result.ok && (
          <p className="text-micro text-muted-foreground">
            Showing the preview only — {result.error}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="max-h-[45vh] min-h-24 shrink space-y-2 overflow-y-auto overscroll-contain rounded-md border border-border bg-muted p-2 lg:max-h-[45%]"
      aria-label="Email thread"
    >
      {messages.map(message => (
        <article
          key={message.id}
          className={`rounded-md border px-3 py-2 text-xs ${
            message.outbound ? 'border-border bg-card/60' : 'border-border bg-card'
          }`}
        >
          <header className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
            <span className="truncate font-medium text-foreground">
              {message.outbound ? 'You' : (message.from.name || message.from.email)}
            </span>
            <span className="shrink-0">{waitingLabel(message.receivedAt)}</span>
          </header>
          <p className="whitespace-pre-wrap break-words">
            {message.bodyText.trim() || '(no text)'}
          </p>
        </article>
      ))}
    </div>
  )
}
