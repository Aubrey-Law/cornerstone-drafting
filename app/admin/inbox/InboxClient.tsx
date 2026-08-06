'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Archive, ChevronDown, ChevronRight, Inbox as InboxIcon, MailOpen, PauseCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { FilterChip } from '@/components/FilterChip'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResponsiveDetailRail,
  useIsMobileDetailViewport,
} from '@/components/layout/ResponsiveDetailRail'
import { CommunicationThread, type ThreadChannelFilter } from '@/components/comms/CommunicationThread'
import { ConversationRow } from '@/components/comms/ConversationRow'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import {
  threadBucket,
  threadIsUnread,
  type CommunicationItem,
  type InboxThread,
  type ThreadBucket,
} from '@/lib/comms/thread'

type ScopeKey = 'needs_reply' | 'all' | 'snoozed'

const CHANNEL_CHIPS: Array<{ key: ThreadChannelFilter; label: string }> = [
  { key: 'all', label: 'All channels' },
  { key: 'portal', label: 'Portal' },
  { key: 'sms', label: 'Texts' },
  { key: 'email', label: 'Email' },
  { key: 'calls', label: 'Calls' },
]

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

interface InboxClientProps {
  initialThreads: InboxThread[]
  smsConfigured: boolean
  voiceConfigured: boolean
}

function GroupShell({
  title,
  count,
  accent = false,
  children,
}: {
  title: string
  count: number
  accent?: boolean
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="flex-none">
      <div className="flex items-center gap-2 px-1 pb-1 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <Badge
          variant="secondary"
          className={cn('text-[11px] tabular-nums', accent && 'bg-destructive/15 text-destructive')}
        >
          {count}
        </Badge>
      </div>
      <ul
        className={cn(
          'divide-y divide-border overflow-hidden rounded-lg border border-border bg-card',
          accent && 'border-l-[3px] border-l-destructive',
        )}
      >
        {children}
      </ul>
    </section>
  )
}

function CollapsedGroup({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="mt-3 flex-none">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
          <span>{title}</span>
          <span className="tabular-nums">· {count}</span>
        </button>
        {open && <ul className="divide-y divide-border border-t border-border">{children}</ul>}
      </div>
    </section>
  )
}

export function InboxClient({ initialThreads, smsConfigured, voiceConfigured }: InboxClientProps) {
  void voiceConfigured // calls render read-only in the timeline; no dialer here yet
  const token = useAccessToken()
  const mobile = useIsMobileDetailViewport()
  const [threads, setThreads] = useState(initialThreads)
  const [scope, setScope] = useState<ScopeKey>('needs_reply')
  const [channel, setChannel] = useState<ThreadChannelFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  const [items, setItems] = useState<CommunicationItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [snoozedOpen, setSnoozedOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const threadHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusKeyRef = useRef<string | null>(null)

  useEffect(() => setThreads(initialThreads), [initialThreads])

  const selected = useMemo(
    () => threads.find(t => t.thread_key === selectedKey) ?? null,
    [threads, selectedKey],
  )

  const filtered = useMemo(
    () => threads.filter(thread => {
      if (channel !== 'all') {
        const wanted = channel === 'calls' ? 'call' : channel
        if (thread.last_channel !== wanted) return false
      }
      return true
    }),
    [threads, channel],
  )

  const buckets = useMemo(() => {
    const now = new Date()
    const grouped: Record<ThreadBucket, InboxThread[]> = {
      overdue: [], today: [], earlier: [], snoozed: [], none: [],
    }
    for (const thread of filtered) grouped[threadBucket(thread, now)].push(thread)
    return grouped
  }, [filtered])

  const channelCounts = useMemo(() => {
    const counts: Record<ThreadChannelFilter, number> = { all: 0, portal: 0, sms: 0, email: 0, calls: 0 }
    for (const thread of threads) {
      counts.all += 1
      if (thread.last_channel === 'call') counts.calls += 1
      else counts[thread.last_channel] += 1
    }
    return counts
  }, [threads])

  const needsReplyCount = buckets.overdue.length + buckets.today.length + buckets.earlier.length

  // Rows in render order — what j/k walk through.
  const rowOrder = useMemo(() => {
    if (scope === 'all') return filtered
    if (scope === 'snoozed') return buckets.snoozed
    return [
      ...buckets.overdue,
      ...buckets.today,
      ...buckets.earlier,
      ...(snoozedOpen ? buckets.snoozed : []),
    ]
  }, [scope, filtered, buckets, snoozedOpen])

  const patchThread = useCallback(async (key: string, patch: Record<string, unknown>) => {
    if (!token) return null
    try {
      const result = await apiRequest<{ state: Record<string, unknown> }>(
        `/api/admin/inbox/threads/${encodeURIComponent(key)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        'Could not update thread',
      )
      invalidateSidebarCountsClient()
      return result.state
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not update thread')
      return null
    }
  }, [token])

  const openThread = useCallback((thread: InboxThread) => {
    returnFocusKeyRef.current = thread.thread_key
    setSelectedKey(thread.thread_key)
    setMobileThreadOpen(true)
    if (threadIsUnread(thread)) {
      // Optimistic: the dot clears now, the PATCH marks the rows read.
      setThreads(prev => prev.map(t => (
        t.thread_key === thread.thread_key
          ? { ...t, unread_count: 0, marked_unread_at: null }
          : t
      )))
      void patchThread(thread.thread_key, { read: true })
    }
    requestAnimationFrame(() => threadHeadingRef.current?.focus())
  }, [patchThread])

  const loadItems = useCallback(async (key: string) => {
    if (!token) return
    setItemsLoading(true)
    try {
      const result = await apiRequest<{ items: CommunicationItem[] }>(
        `/api/admin/inbox/threads/${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        'Could not load thread',
      )
      setItems(Array.isArray(result.items) ? result.items : [])
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not load thread')
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [token])

  useEffect(() => {
    setItems([])
    if (selectedKey) void loadItems(selectedKey)
  }, [selectedKey, loadItems])

  const sendReply = useCallback(async (replyChannel: 'portal' | 'sms', body: string) => {
    if (!token || !selected) return false
    setSending(true)
    try {
      // Existing endpoints keep authorization, audit fields and provider checks.
      if (replyChannel === 'portal') {
        if (!selected.matter_id) throw new Error('Portal messages need a matter')
        await apiRequest('/api/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ matter_id: selected.matter_id, body }),
        }, 'Send failed')
      } else if (selected.record_type === 'matter') {
        await apiRequest(`/api/admin/matters/${selected.matter_id}/send-sms`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: 'client', body }),
        }, 'Send failed')
      } else {
        const base = selected.record_type === 'contact'
          ? `/api/admin/contacts/${selected.contact_id}`
          : `/api/admin/leads/${selected.lead_id}`
        await apiRequest(`${base}/send-sms`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        }, 'Send failed')
      }
      toast.success(replyChannel === 'portal' ? 'Message sent' : 'Text sent')
      setThreads(prev => prev.map(t => (
        t.thread_key === selected.thread_key ? { ...t, waiting_since: null } : t
      )))
      invalidateSidebarCountsClient()
      await loadItems(selected.thread_key)
      return true
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send')
      return false
    } finally {
      setSending(false)
    }
  }, [token, selected, loadItems])

  const snoozeSelected = useCallback(async (thread: InboxThread, days: number, label: string) => {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    setThreads(prev => prev.map(t => (
      t.thread_key === thread.thread_key ? { ...t, snoozed_until: until } : t
    )))
    const state = await patchThread(thread.thread_key, { snoozed_until: until })
    if (state) toast.success(`Snoozed until ${label.toLowerCase()}`)
  }, [patchThread])

  const archiveThread = useCallback(async (thread: InboxThread) => {
    setThreads(prev => prev.filter(t => t.thread_key !== thread.thread_key))
    if (selectedKey === thread.thread_key) {
      setSelectedKey(null)
      setMobileThreadOpen(false)
    }
    const state = await patchThread(thread.thread_key, { archived: true })
    if (state) toast.success('Archived')
  }, [patchThread, selectedKey])

  const toggleUnread = useCallback(async (thread: InboxThread) => {
    const makeUnread = !threadIsUnread(thread)
    setThreads(prev => prev.map(t => (
      t.thread_key === thread.thread_key
        ? { ...t, marked_unread_at: makeUnread ? new Date().toISOString() : null, unread_count: makeUnread ? t.unread_count : 0 }
        : t
    )))
    await patchThread(thread.thread_key, { read: !makeUnread })
  }, [patchThread])

  // Shortcuts live on the list container, not document, so ⌘K and the
  // calendar's bindings are untouched.
  const handleListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const index = rowOrder.findIndex(t => t.thread_key === selectedKey)
    const move = (delta: number) => {
      if (rowOrder.length === 0) return
      const next = index === -1 ? (delta > 0 ? 0 : rowOrder.length - 1) : index + delta
      const clamped = Math.max(0, Math.min(rowOrder.length - 1, next))
      const thread = rowOrder[clamped]
      openThread(thread)
      document.getElementById(`inbox-row-${thread.thread_key}`)?.scrollIntoView({ block: 'nearest' })
    }
    switch (event.key) {
      case 'j': case 'J': event.preventDefault(); move(1); break
      case 'k': case 'K': event.preventDefault(); move(-1); break
      case 'r': case 'R':
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>('[aria-label^="Reply by"]')?.focus()
        break
      case 'e': case 'E':
        if (selected) { event.preventDefault(); void archiveThread(selected) }
        break
      case 'u': case 'U':
        if (selected) { event.preventDefault(); void toggleUnread(selected) }
        break
      default: break
    }
  }, [rowOrder, selectedKey, selected, openThread, archiveThread, toggleUnread])

  const renderRow = (thread: InboxThread) => (
    <ConversationRow
      key={thread.thread_key}
      thread={thread}
      selected={thread.thread_key === selectedKey}
      onSelect={() => openThread(thread)}
    />
  )

  const threadPane = selected ? (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 ref={threadHeadingRef} tabIndex={-1} className="truncate text-base font-semibold outline-none">
            {selected.display_name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {selected.record_type === 'matter'
              ? (selected.matter_number ?? 'Matter')
              : selected.record_type === 'contact'
                ? 'Contact'
                : 'Lead'}
            {selected.stage ? ` · ${selected.stage.replaceAll('_', ' ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs">
                <PauseCircle className="size-3.5" />
                Snooze
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-medium">Snooze until</DropdownMenuLabel>
              {SNOOZE_OPTIONS.map(option => (
                <DropdownMenuItem
                  key={option.label}
                  onSelect={() => void snoozeSelected(selected, option.days, option.label)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void toggleUnread(selected)}>
            <MailOpen className="size-3.5" />
            {threadIsUnread(selected) ? 'Mark read' : 'Mark unread'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void archiveThread(selected)}>
            <Archive className="size-3.5" />
            Archive
          </Button>
        </div>
      </div>
      <CommunicationThread
        items={items}
        loading={itemsLoading}
        recordType={selected.record_type}
        recordLabel={selected.matter_number ?? selected.display_name}
        recipientName={selected.display_name}
        recipientPhone={selected.contact_phone}
        smsConfigured={smsConfigured}
        sending={sending}
        onSend={sendReply}
        emailComposer={
          <div className="rounded-md border border-border">
            <ManualEmailComposer
              embedded
              recordOverride={{
                type: selected.record_type,
                id: (selected.record_type === 'matter'
                  ? selected.matter_id
                  : selected.record_type === 'contact'
                    ? selected.contact_id
                    : selected.lead_id) ?? selected.thread_key,
              }}
              // A contact has no compose-context endpoint; hand it the
              // recipient the thread already knows about.
              initialContext={selected.record_type === 'contact' ? {
                recordType: 'contact',
                recordId: selected.contact_id ?? selected.thread_key,
                recipientName: selected.display_name,
                recipientEmail: selected.contact_email,
                spouseName: null,
                spouseEmail: null,
                alternateEmails: [],
                documents: [],
              } : undefined}
              onSent={() => {
                toast.success('Email sent')
                void loadItems(selected.thread_key)
              }}
            />
          </div>
        }
      />
    </div>
  ) : (
    <EmptyState
      icon={InboxIcon}
      title="Select a conversation"
      description="Pick a thread from the list to read and reply."
      className="hidden flex-1 rounded-lg border border-border bg-card md:flex"
    />
  )

  return (
    <AdminPageShell aria-label="Inbox">
      <PageHeader
        eyebrow="Communications"
        icon={InboxIcon}
        title="Inbox"
        description="Every unanswered client message — portal, text, email and calls — in one queue."
      />

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <FilterChip selected={scope === 'needs_reply'} count={needsReplyCount} onClick={() => setScope('needs_reply')}>
          Needs reply
        </FilterChip>
        <FilterChip selected={scope === 'all'} count={channelCounts.all} onClick={() => setScope('all')}>
          All
        </FilterChip>
        <FilterChip selected={scope === 'snoozed'} count={buckets.snoozed.length} onClick={() => setScope('snoozed')}>
          Snoozed
        </FilterChip>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        {CHANNEL_CHIPS.map(chip => (
          <FilterChip
            key={chip.key}
            selected={channel === chip.key}
            onClick={() => setChannel(chip.key)}
          >
            {chip.label}
          </FilterChip>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[392px_minmax(0,1fr)]">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          ref={listRef}
          role="region"
          aria-label="Conversations"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="min-h-0 overflow-y-auto outline-none"
        >
          {rowOrder.length === 0 && buckets.snoozed.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="Inbox zero"
              description="No client messages are waiting on a reply."
              className="rounded-lg border border-border bg-card"
            />
          ) : scope === 'needs_reply' ? (
            <div>
              <GroupShell title="Overdue" count={buckets.overdue.length} accent>
                {buckets.overdue.map(renderRow)}
              </GroupShell>
              <GroupShell title="Today" count={buckets.today.length}>
                {buckets.today.map(renderRow)}
              </GroupShell>
              <GroupShell title="Earlier" count={buckets.earlier.length}>
                {buckets.earlier.map(renderRow)}
              </GroupShell>
              <CollapsedGroup
                title="Snoozed"
                count={buckets.snoozed.length}
                open={snoozedOpen}
                onToggle={() => setSnoozedOpen(prev => !prev)}
              >
                {buckets.snoozed.map(renderRow)}
              </CollapsedGroup>
              {needsReplyCount === 0 && (
                <EmptyState
                  icon={InboxIcon}
                  title="Nothing needs a reply"
                  description="Every client message has been answered."
                  className="mt-3 rounded-lg border border-border bg-card"
                />
              )}
            </div>
          ) : (
            <GroupShell
              title={scope === 'snoozed' ? 'Snoozed' : 'All conversations'}
              count={rowOrder.length}
            >
              {rowOrder.map(renderRow)}
            </GroupShell>
          )}
        </div>

        {mobile ? (
          <ResponsiveDetailRail
            open={mobileThreadOpen && Boolean(selected)}
            onOpenChange={open => {
              setMobileThreadOpen(open)
              if (!open && returnFocusKeyRef.current) {
                document.getElementById(`inbox-row-${returnFocusKeyRef.current}`)?.focus()
              }
            }}
            label="Conversation"
            mobileClassName="flex w-[min(24rem,100vw)] flex-col p-3"
          >
            {threadPane}
          </ResponsiveDetailRail>
        ) : (
          threadPane
        )}
      </div>
    </AdminPageShell>
  )
}
