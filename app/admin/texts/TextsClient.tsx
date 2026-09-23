'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Link2, Loader2, MessageSquarePlus, MessageSquareText, Send, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { EmptyState } from '@/components/EmptyState'
import { FilterChip } from '@/components/FilterChip'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { linkifyText } from '@/lib/linkify'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { supabase } from '@/lib/supabaseClient'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import { cn } from '@/lib/utils'
import type {
  SmsThread,
  SmsThreadFilter,
  SmsThreadKind,
  SmsThreadMessage,
} from '@/lib/queries/smsThreads'
import type { TextRecipient } from '@/app/api/admin/texts/recipients/route'

interface Props {
  initialThreads: SmsThread[]
  /** 10-digit key from `?phone=`, opened on load. */
  initialPhone: string | null
  sendingEnabled: boolean
  loadError: string | null
}

const KIND_LABEL: Record<SmsThreadKind, string> = {
  lead: 'Lead',
  client: 'Client',
  contact: 'Contact',
  unknown: 'Unknown',
}

const FILTERS: Array<{ key: SmsThreadFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'unknown', label: 'Unknown' },
]

const POLL_MS = 30_000

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const FULL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatPhone(key: string): string {
  return key.length === 10 ? `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}` : key
}

function listTime(iso: string): string {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString() ? TIME.format(date) : DAY.format(date)
}

function phoneKey(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.length === 10 ? digits : null
}

function threadTitle(thread: Pick<SmsThread, 'name' | 'phone'>): string {
  return thread.name || formatPhone(thread.phone)
}

/** Wording for an outbound message's delivery state. */
function deliveryLabel(message: SmsThreadMessage): string | null {
  if (message.direction !== 'outbound') return null
  if (message.status === 'failed' || message.status === 'delivery_failed') {
    return message.error ? `Failed: ${message.error}` : 'Failed'
  }
  if (message.status === 'delivered') return 'Delivered'
  if (message.status === 'pending' || message.status === 'queued') return 'Sending…'
  return 'Sent'
}

export function TextsClient({ initialThreads, initialPhone, sendingEnabled, loadError }: Props) {
  const token = useAccessToken()
  const router = useRouter()
  const [filter, setFilter] = useState<SmsThreadFilter>('all')
  const [threads, setThreads] = useState<SmsThread[]>(initialThreads)
  const [listError, setListError] = useState<string | null>(loadError)
  const [selected, setSelected] = useState<string | null>(initialPhone ?? initialThreads[0]?.phone ?? null)
  // Name and link for a number picked in "New text" that has no conversation yet.
  const [pendingRecipient, setPendingRecipient] = useState<TextRecipient | null>(null)
  const [messages, setMessages] = useState<SmsThreadMessage[]>([])
  const [thread, setThread] = useState<SmsThread | null>(null)
  // True from the first paint when a conversation is preselected, so it never
  // flashes "No messages yet" before its first load starts.
  const [threadLoading, setThreadLoading] = useState(Boolean(initialPhone ?? initialThreads[0]))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [newTextOpen, setNewTextOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [createLeadOpen, setCreateLeadOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'message'; message: SmsThreadMessage } | { kind: 'thread' } | null
  >(null)
  const logRef = useRef<HTMLOListElement>(null)
  // Lets async loads drop a response for a conversation no longer on screen.
  // Updated in an effect declared before the loading effects, so it is
  // current by the time they run.
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])

  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token])

  const loadThreads = useCallback(async () => {
    if (!headers) return
    try {
      const { threads: rows } = await apiRequest<{ threads: SmsThread[] }>(
        `/api/admin/texts/threads?filter=${filter}`,
        { headers },
      )
      setThreads(rows)
      setListError(null)
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Texts are unavailable.')
    }
  }, [headers, filter])

  const markRead = useCallback(async (phone: string) => {
    if (!headers) return
    try {
      const { marked } = await apiRequest<{ marked: number }>(
        `/api/admin/texts/threads/${phone}/read`,
        { method: 'POST', headers },
      )
      if (marked > 0) {
        setThreads(rows => rows.map(row => (row.phone === phone ? { ...row, unreadCount: 0 } : row)))
        invalidateSidebarCountsClient()
      }
    } catch {
      // Unread state is a convenience; the conversation is still readable.
    }
  }, [headers])

  const loadThread = useCallback(async (phone: string, { quiet = false } = {}) => {
    if (!headers) return
    if (!quiet) setThreadLoading(true)
    try {
      const data = await apiRequest<{ thread: SmsThread | null; messages: SmsThreadMessage[] }>(
        `/api/admin/texts/threads/${phone}`,
        { headers },
      )
      if (selectedRef.current !== phone) return
      setThread(data.thread)
      setMessages(data.messages)
      if (data.thread && data.thread.unreadCount > 0) void markRead(phone)
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : 'Could not load conversation')
    } finally {
      if (!quiet) setThreadLoading(false)
    }
  }, [headers, markRead])

  useEffect(() => { void loadThreads() }, [loadThreads])

  // Reset only when the conversation changes, so a token refresh (which
  // rebuilds loadThread) never throws away a half-written reply.
  useEffect(() => {
    setDraft('')
    setThread(null)
    setMessages([])
  }, [selected])
  useEffect(() => {
    if (selected) void loadThread(selected)
  }, [selected, loadThread])

  // Live updates: any text in or out refreshes the list and the open thread.
  // Polling covers a dropped realtime connection.
  useEffect(() => {
    const refresh = () => {
      void loadThreads()
      if (selectedRef.current) void loadThread(selectedRef.current, { quiet: true })
    }
    const channel = supabase
      .channel('texts-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_messages' }, refresh)
      .subscribe()
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [loadThreads, loadThread])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages.length])

  const selectThread = useCallback((phone: string, recipient: TextRecipient | null = null) => {
    setPendingRecipient(recipient)
    setSelected(phone)
    router.replace(`/admin/texts?phone=${phone}`, { scroll: false })
  }, [router])

  // Until the conversation loads, describe it from its list row so the header
  // never flashes "Unknown" and an opted-out number never shows a composer.
  const summary = thread ?? threads.find(row => row.phone === selected) ?? null
  const kind: SmsThreadKind = summary?.kind ?? pendingRecipient?.kind ?? 'unknown'
  const limit = kind === 'lead' ? MAX_LEAD_SMS_BODY_LENGTH : MAX_SMS_BODY_LENGTH
  const title = summary
    ? threadTitle(summary)
    : pendingRecipient?.name ?? (selected ? formatPhone(selected) : '')
  const optedOut = summary?.optedOut ?? false

  async function send() {
    if (!headers || !selected || !draft.trim() || sending) return
    setSending(true)
    try {
      await apiRequest(`/api/admin/texts/threads/${selected}/send`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: draft.trim(),
          link: !thread && pendingRecipient
            ? {
                leadId: pendingRecipient.leadId,
                matterId: pendingRecipient.matterId,
                contactId: pendingRecipient.contactId,
                name: pendingRecipient.name,
              }
            : null,
        }),
      }, 'Could not send text')
      setDraft('')
      await Promise.all([loadThread(selected, { quiet: true }), loadThreads()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send text')
      // A failed send still leaves a row explaining why; show it.
      void loadThread(selected, { quiet: true })
    } finally {
      setSending(false)
    }
  }

  async function confirmDelete() {
    if (!headers || !selected || !pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    try {
      if (target.kind === 'message') {
        await apiRequest(`/api/admin/texts/messages/${target.message.id}`, { method: 'DELETE', headers }, 'Could not delete text')
        setMessages(rows => rows.filter(row => row.id !== target.message.id))
        toast.success('Text deleted')
        await Promise.all([loadThread(selected, { quiet: true }), loadThreads()])
      } else {
        await apiRequest(`/api/admin/texts/threads/${selected}`, { method: 'DELETE', headers }, 'Could not delete conversation')
        toast.success('Conversation deleted')
        const next = threads.find(row => row.phone !== selected)?.phone ?? null
        setThreads(rows => rows.filter(row => row.phone !== selected))
        setPendingRecipient(null)
        setSelected(next)
        router.replace(next ? `/admin/texts?phone=${next}` : '/admin/texts', { scroll: false })
        void loadThreads()
      }
      invalidateSidebarCountsClient()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete')
    }
  }

  const composerNote = !sendingEnabled
    ? 'Texting is turned off. Conversations are read-only.'
    : optedOut
      ? 'This number replied STOP and has opted out of texts. They can text START to opt back in.'
      : null

  return (
    <AdminPageShell>
      <PageHeader
        title="Texts"
        eyebrow="Daily"
        icon={MessageSquareText}
        description="Text messages with leads, clients and anyone else who texts the firm number."
        actions={
          <Button size="sm" onClick={() => setNewTextOpen(true)} disabled={!sendingEnabled}>
            <MessageSquarePlus className="h-4 w-4" />
            New text
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_1fr]">
        <section aria-label="Conversations" className="flex min-h-0 flex-col gap-3">
          <div className="flex gap-2">
            {FILTERS.map(item => (
              <FilterChip key={item.key} selected={filter === item.key} onClick={() => setFilter(item.key)}>
                {item.label}
              </FilterChip>
            ))}
          </div>
          {listError && <p role="alert" className="text-sm text-destructive">{listError}</p>}
          {threads.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title={filter === 'all' ? 'No texts yet' : filter === 'unread' ? 'Nothing unread' : 'No unknown senders'}
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {threads.map(row => (
                <li key={row.phone}>
                  <button
                    type="button"
                    onClick={() => selectThread(row.phone)}
                    aria-current={row.phone === selected ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent',
                      row.phone === selected && 'bg-accent',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {row.unreadCount > 0 && (
                        <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                      )}
                      <span className={cn('truncate text-sm', row.unreadCount > 0 && 'font-semibold')}>
                        {threadTitle(row)}
                      </span>
                      <Badge variant={row.kind === 'unknown' ? 'outline' : 'secondary'} className="shrink-0">
                        {KIND_LABEL[row.kind]}
                      </Badge>
                      <time className="ml-auto shrink-0 text-micro text-muted-foreground" dateTime={row.lastMessageAt}>
                        {listTime(row.lastMessageAt)}
                      </time>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.lastDirection === 'outbound' ? 'You: ' : ''}
                      {row.lastBody}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Conversation" className="flex min-h-0 flex-col gap-3 rounded-md border border-border p-3">
          {!selected ? (
            <EmptyState icon={MessageSquareText} title="Pick a conversation" />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {title === formatPhone(selected) ? KIND_LABEL[kind] : `${formatPhone(selected)} · ${KIND_LABEL[kind]}`}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  {thread?.href ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={thread.href}>Open record</Link>
                    </Button>
                  ) : thread ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                        <Link2 className="h-3.5 w-3.5" />
                        Link to record
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCreateLeadOpen(true)}>
                        <UserPlus className="h-3.5 w-3.5" />
                        Create lead
                      </Button>
                    </>
                  ) : null}
                  {thread && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDelete({ kind: 'thread' })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete conversation
                    </Button>
                  )}
                </div>
              </header>

              <ol
                ref={logRef}
                role="log"
                aria-label="Messages"
                aria-live="polite"
                className="min-h-48 flex-1 space-y-2 overflow-y-auto"
              >
                {threadLoading ? (
                  <li className="text-xs text-muted-foreground">Loading…</li>
                ) : messages.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No messages yet. Write the first one below.</li>
                ) : (
                  messages.map(message => (
                    <li
                      key={message.id}
                      className={cn(
                        'flex flex-col gap-0.5',
                        message.direction === 'outbound' ? 'items-end' : 'items-start',
                      )}
                    >
                      <p
                        className={cn(
                          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
                          message.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted',
                          message.status === 'opt_out' && 'italic',
                        )}
                      >
                        {linkifyText(message.body)}
                      </p>
                      <span className="flex items-center gap-1 text-micro text-muted-foreground">
                        {FULL.format(new Date(message.createdAt))}
                        {message.direction === 'outbound' && message.actorName ? ` · ${message.actorName}` : ''}
                        {deliveryLabel(message) ? ` · ${deliveryLabel(message)}` : ''}
                        {message.status === 'opt_out' ? ' · Opted out' : ''}
                        <button
                          type="button"
                          onClick={() => setPendingDelete({ kind: 'message', message })}
                          className="ml-1 rounded p-1 hover:bg-accent hover:text-destructive"
                          aria-label={`Delete text from ${FULL.format(new Date(message.createdAt))}`}
                        >
                          <Trash2 className="size-3" aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))
                )}
              </ol>

              {threadLoading && !summary ? null : composerNote ? (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{composerNote}</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value.slice(0, limit))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void send()
                        }
                      }}
                      placeholder={`Text ${title}…`}
                      aria-label={`Text ${title}`}
                      rows={2}
                      className="min-h-[60px] flex-1"
                    />
                    <Button onClick={() => void send()} disabled={sending || !draft.trim()}>
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send
                    </Button>
                  </div>
                  <p className="text-right text-micro text-muted-foreground">
                    {draft.length}/{limit} · ⌘Enter to send
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <RecipientDialog
        open={newTextOpen}
        onOpenChange={setNewTextOpen}
        title="New text"
        description="Pick a lead, client or contact, or type a phone number."
        allowTypedNumber
        headers={headers}
        onPick={recipient => {
          setNewTextOpen(false)
          if (!recipient.phone) {
            toast.error(`${recipient.name} has no textable phone number on file.`)
            return
          }
          selectThread(recipient.phone, recipient)
        }}
        onPickNumber={phone => {
          setNewTextOpen(false)
          selectThread(phone)
        }}
      />

      <RecipientDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title="Link to record"
        description={selected ? `Attach texts from ${formatPhone(selected)} to a lead, client or contact.` : ''}
        headers={headers}
        onPick={async recipient => {
          if (!headers || !selected) return
          try {
            await apiRequest(`/api/admin/texts/threads/${selected}/link`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                leadId: recipient.leadId,
                matterId: recipient.matterId,
                contactId: recipient.contactId,
              }),
            }, 'Could not link conversation')
            toast.success(`Linked to ${recipient.name}`)
            setLinkOpen(false)
            await Promise.all([loadThread(selected, { quiet: true }), loadThreads()])
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not link conversation')
          }
        }}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'thread' ? `Delete the conversation with ${title}?` : 'Delete this text?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'thread'
                ? 'Every text with this number disappears from Texts and from the record. '
                : 'It disappears from Texts and from the record. '}
              It is not unsent: the other person keeps their copy. The firm keeps a record of what was deleted and by whom.
              {pendingDelete?.kind === 'thread' && optedOut ? ' This number stays opted out.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selected && (
        <CreateLeadDialog
          open={createLeadOpen}
          onOpenChange={setCreateLeadOpen}
          phone={selected}
          headers={headers}
          onCreated={async () => {
            setCreateLeadOpen(false)
            await Promise.all([loadThread(selected, { quiet: true }), loadThreads()])
          }}
        />
      )}
    </AdminPageShell>
  )
}

function RecipientDialog({
  open,
  onOpenChange,
  title,
  description,
  allowTypedNumber = false,
  headers,
  onPick,
  onPickNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  allowTypedNumber?: boolean
  headers: Record<string, string> | undefined
  onPick: (recipient: TextRecipient) => void | Promise<void>
  /** A typed number that matched no one; only offered with `allowTypedNumber`. */
  onPickNumber?: (phone: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TextRecipient[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]) }
  }, [open])

  useEffect(() => {
    if (!headers || query.trim().length < 2) { setResults([]); return }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const { recipients } = await apiRequest<{ recipients: TextRecipient[] }>(
          `/api/admin/texts/recipients?q=${encodeURIComponent(query.trim())}`,
          { headers, signal: controller.signal },
        )
        setResults(recipients)
      } catch {
        if (!controller.signal.aborted) setResults([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, headers])

  const typed = allowTypedNumber && onPickNumber ? phoneKey(query) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={allowTypedNumber ? 'Name, email or phone number' : 'Name, email or phone'}
          aria-label="Search people"
        />
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {typed && (
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onPickNumber?.(typed)}
              >
                Text {formatPhone(typed)}
              </button>
            </li>
          )}
          {results.map(recipient => (
            <li key={`${recipient.kind}:${recipient.leadId ?? recipient.matterId ?? recipient.contactId}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void onPick(recipient)}
              >
                <span className="truncate">{recipient.name}</span>
                <Badge variant="secondary">{KIND_LABEL[recipient.kind]}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {recipient.phone ? formatPhone(recipient.phone) : 'No phone'}
                </span>
              </button>
            </li>
          ))}
          {searching && <li className="px-2 py-2 text-xs text-muted-foreground">Searching…</li>}
          {!searching && query.trim().length >= 2 && results.length === 0 && !typed && (
            <li className="px-2 py-2 text-xs text-muted-foreground">No matches.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function CreateLeadDialog({
  open,
  onOpenChange,
  phone,
  headers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  phone: string
  headers: Record<string, string> | undefined
  onCreated: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) { setName(''); setEmail('') }
  }, [open])

  async function create() {
    if (!headers || !name.trim() || !email.trim()) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/texts/threads/${phone}/create-lead`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: name.trim(), clientEmail: email.trim() }),
      }, 'Could not create lead')
      toast.success(`Lead created for ${name.trim()}`)
      await onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create lead</DialogTitle>
          <DialogDescription>
            A new lead with phone {formatPhone(phone)}. This conversation is attached to it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="texts-lead-name">Name</Label>
            <Input id="texts-lead-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="texts-lead-email">Email</Label>
            <Input id="texts-lead-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void create()} disabled={saving || !name.trim() || !email.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
