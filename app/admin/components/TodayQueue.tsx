'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowRight,
  BellRing,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Mail,
  MessageSquare,
  PauseCircle,
  Phone,
  PlayCircle,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import type { TodayQueueRow, TodayUnreadThread } from '@/lib/queries/today'
import { compareTasks, type TaskRow } from '@/lib/tasks/types'
import { TaskListRow } from '@/components/tasks/TaskPrimitives'
import { useTaskActions } from '@/components/tasks/useTaskActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const TODAY_CLEARED_EVENT = 'today:cleared'

/** Serializable projection of a matter for the non-aging queue groups. */
export interface TodayMatterItem {
  matter_id: string
  client_name: string | null
  stage_label: string
}

interface TodayQueueProps {
  waitingOnYou: TodayQueueRow[]
  waitingOnClient: TodayQueueRow[]
  snoozed: TodayQueueRow[]
  unreadThreads: TodayUnreadThread[]
  intakeReview: TodayMatterItem[]
  intakeToSend: TodayMatterItem[]
  overdueTasks: TaskRow[]
  tasksDueToday: TaskRow[]
}

type PrimaryDecision =
  | { kind: 'task'; key: string; task: TaskRow; urgency: 'Overdue task' | 'Due today' }
  | { kind: 'aging'; key: string; row: TodayQueueRow; urgency: 'Blocking a client' | 'Needs attention' }
  | { kind: 'message'; key: string; thread: TodayUnreadThread }
  | { kind: 'review'; key: string; matter: TodayMatterItem }
  | { kind: 'send'; key: string; matter: TodayMatterItem }

type TabKey = 'you' | 'clients' | 'snoozed'

const QUEUE_PREVIEW_COUNT = 10
const BLOCKING_DAYS_OVER = 7

const SNOOZE_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

function rowKey(row: TodayQueueRow) {
  return `${row.entity}:${row.id}`
}

function rowHref(row: TodayQueueRow) {
  return row.entity === 'lead' ? `/admin/crm/opportunities/${row.id}` : `/admin/matters/${row.id}`
}

function leadActionHref(row: TodayQueueRow) {
  return row.action?.label === 'Call' && row.client_phone
    ? `tel:${row.client_phone}`
    : row.action?.href ?? rowHref(row)
}

function taskHref(task: TaskRow) {
  if (task.matter_id) return `/admin/matters/${task.matter_id}?tab=tasks`
  if (task.lead_id) return `/admin/crm/opportunities/${task.lead_id}?tab=tasks`
  return '/admin/tasks'
}

function daysCell(row: TodayQueueRow) {
  const over = row.days_over_sla != null && row.days_over_sla > 0
  return {
    text: over ? `+${row.days_over_sla}d` : `${row.days_in_stage}d`,
    title: over ? `${row.days_over_sla} days over SLA` : `${row.days_in_stage} days in stage`,
    tone:
      row.health === 'red'
        ? 'text-red-strong'
        : row.health === 'amber'
          ? 'text-amber-orange'
          : 'text-muted-foreground',
  }
}

function snoozeOptions(now = new Date()) {
  return [
    { label: 'Tomorrow', days: 1 },
    { label: '3 days', days: 3 },
    { label: 'Next week', days: 7 },
    { label: 'Two weeks', days: 14 },
  ].map(opt => {
    const until = new Date(now.getTime() + opt.days * 86_400_000)
    return { ...opt, until, dateLabel: SNOOZE_DATE.format(until) }
  })
}

function announceCleared() {
  window.dispatchEvent(new Event(TODAY_CLEARED_EVENT))
}

function focusClass(focused: boolean) {
  return focused ? 'bg-muted shadow-[inset_3px_0_0] shadow-primary' : undefined
}

/** One keyboard-focusable row: what E, S, N, W, and X do when it has the ring. */
interface FocusTarget {
  key: string
  run?: () => void
  snoozeRow?: TodayQueueRow
  nudge?: () => void
  wake?: () => void
  complete?: () => void
}

function GroupHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {count > 0 && (
        <Badge variant="secondary" className="text-micro">
          {count}
        </Badge>
      )}
    </div>
  )
}

function SnoozeMenu({
  row,
  open,
  onOpenChange,
  onSnooze,
}: {
  row: TodayQueueRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSnooze: (row: TodayQueueRow, until: Date, label: string) => void
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs">
          <PauseCircle className="h-3.5 w-3.5" />
          Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium">Snooze until</DropdownMenuLabel>
        {snoozeOptions().map(opt => (
          <DropdownMenuItem key={opt.label} onSelect={() => onSnooze(row, opt.until, opt.dateLabel)}>
            <span>{opt.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{opt.dateLabel}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-micro leading-snug text-muted-foreground">
          Snoozing hides it from Today and pauses the SLA clock.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface RowHandlers {
  snoozeMenuKey: string | null
  setSnoozeMenuKey: (key: string | null) => void
  onSnooze: (row: TodayQueueRow, until: Date, label: string) => void
  onNudge: (row: TodayQueueRow) => void
}

function RowActions({ row, handlers }: { row: TodayQueueRow; handlers: RowHandlers }) {
  const key = rowKey(row)
  const snoozeMenu = (
    <SnoozeMenu
      row={row}
      open={handlers.snoozeMenuKey === key}
      onOpenChange={open => handlers.setSnoozeMenuKey(open ? key : null)}
      onSnooze={handlers.onSnooze}
    />
  )
  if (row.entity === 'lead') {
    return (
      <span className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <Button asChild size="sm">
          <Link href={leadActionHref(row)}>{row.action?.label ?? 'Open lead'}</Link>
        </Button>
        {row.client_phone && row.action?.label !== 'Call' ? (
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${row.client_phone}`}><Phone className="h-4 w-4" aria-hidden />Call</a>
          </Button>
        ) : null}
        {snoozeMenu}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2 sm:shrink-0">
      {row.nudge_matter_id ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => handlers.onNudge(row)}
        >
          <BellRing className="h-3.5 w-3.5" />
          {row.action?.label ?? 'Resend'}
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="h-8 text-xs">
          <Link href={row.action?.href ?? rowHref(row)}>{row.action?.label ?? 'Open'}</Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
        <Link href={rowHref(row)}>Open</Link>
      </Button>
      {snoozeMenu}
    </span>
  )
}

function AgingRow({
  row,
  focused,
  handlers,
}: {
  row: TodayQueueRow
  focused: boolean
  handlers: RowHandlers
}) {
  const days = daysCell(row)
  return (
    <li
      id={`today-row-${rowKey(row)}`}
      className={cn(
        'grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-3 p-4 transition-colors duration-150 ease-out motion-reduce:transition-none hover:bg-accent sm:flex sm:items-center',
        focusClass(focused),
      )}
    >
      <span
        className={cn('w-12 shrink-0 text-right text-xs font-semibold tabular-nums', days.tone)}
        title={days.title}
      >
        {days.text}
      </span>
      <span className="min-w-0 flex-1">
        <Link
          href={rowHref(row)}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {row.client_name ?? `Unnamed ${row.entity}`}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          {engineStageLabel(row.current_stage)}
          {row.entity === 'lead' && ' · lead'}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{days.title}</p>
        {row.action?.title && <p className="mt-1 text-sm font-medium">{row.action.title}</p>}
        {row.action?.detail && <p className="mt-1 text-xs text-muted-foreground">{row.action.detail}</p>}
      </span>
      <div className="col-span-2 sm:ml-auto">
        <RowActions row={row} handlers={handlers} />
      </div>
    </li>
  )
}

function SimpleRow({
  id,
  href,
  icon: Icon,
  primary,
  secondary,
  cta,
  focused,
}: {
  id: string
  href: string
  icon: React.ElementType
  primary: string
  secondary: string
  cta: string
  focused: boolean
}) {
  return (
    <li id={`today-row-${id}`} className={cn('transition-colors', focusClass(focused))}>
      <Link href={href} className="group flex items-center gap-3 px-3 py-2 hover:bg-accent">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{primary}</span>
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        </span>
        <span className="inline-flex flex-wrap items-center gap-2 sm:shrink-0 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          {cta}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  )
}

export function TodayQueue({
  waitingOnYou,
  waitingOnClient,
  snoozed,
  unreadThreads,
  intakeReview,
  intakeToSend,
  overdueTasks,
  tasksDueToday,
}: TodayQueueProps) {
  const router = useRouter()
  const token = useAccessToken()
  const [tab, setTab] = useState<TabKey>('you')
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [overdueExpanded, setOverdueExpanded] = useState(false)
  const [clientsExpanded, setClientsExpanded] = useState(false)
  const [laterOpen, setLaterOpen] = useState(false)
  const [nudgePreviewOpen, setNudgePreviewOpen] = useState(false)
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [snoozeMenuKey, setSnoozeMenuKey] = useState<string | null>(null)
  const [nudging, setNudging] = useState(false)
  // Completed tasks leave the queue immediately; router.refresh() confirms it.
  const [completedTaskIds, setCompletedTaskIds] = useState<ReadonlySet<string>>(new Set())

  const authHeaders = useCallback(
    (): HeadersInit => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    }),
    [token],
  )

  const visible = useCallback(
    (rows: TodayQueueRow[]) => rows.filter(r => !removedKeys.has(rowKey(r))),
    [removedKeys],
  )

  // Optimistic removals only bridge the gap until router.refresh() lands; once
  // fresh server rows arrive the moved row lives in its new list, so keeping
  // the key would wrongly hide it there (snoozed rows from Snoozed, woken rows
  // from the queue).
  useEffect(() => {
    setRemovedKeys(prev => (prev.size === 0 ? prev : new Set()))
  }, [waitingOnYou, waitingOnClient, snoozed])

  const mineAll = visible(waitingOnYou)
  const blocking = mineAll.filter(r => (r.days_over_sla ?? 0) >= BLOCKING_DAYS_OVER)
  const queue = mineAll.filter(r => (r.days_over_sla ?? 0) < BLOCKING_DAYS_OVER)
  const clientRows = visible(waitingOnClient)
  const clientRowsShown = clientsExpanded ? clientRows : clientRows.slice(0, QUEUE_PREVIEW_COUNT)
  const snoozedRows = visible(snoozed)
  const nudgeCandidates = clientRows.filter(row => row.nudge_matter_id)
  const sendableNudges = nudgeCandidates.filter(row => row.client_email)
  const skippedNudges = nudgeCandidates.filter(row => !row.client_email)

  const setKeyRemoved = useCallback((key: string, removed: boolean) => {
    setRemovedKeys(prev => {
      const next = new Set(prev)
      if (removed) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const snoozeRow = useCallback(
    async (row: TodayQueueRow, until: Date, label: string) => {
      if (!token) {
        toast.error('Not signed in')
        return
      }
      const key = rowKey(row)
      setKeyRemoved(key, true)
      const res = await fetch('/api/admin/pipeline/aging/snooze', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          entity: row.entity,
          entity_id: row.id,
          stage_key: row.current_stage,
          snoozed_until: until.toISOString(),
        }),
      })
      if (!res.ok) {
        setKeyRemoved(key, false)
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Snooze failed')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { snooze?: { id: number } }
      const snoozeId = body.snooze?.id
      invalidateSidebarCountsClient()
      announceCleared()
      router.refresh()
      toast.success(`Snoozed ${row.client_name ?? row.entity} until ${label}`, {
        action:
          snoozeId != null
            ? {
                label: 'Undo',
                onClick: () => {
                  void (async () => {
                    const undo = await fetch('/api/admin/pipeline/aging/snooze', {
                      method: 'DELETE',
                      headers: authHeaders(),
                      body: JSON.stringify({ snooze_id: snoozeId }),
                    })
                    if (!undo.ok) {
                      toast.error('Could not undo snooze')
                      return
                    }
                    setKeyRemoved(key, false)
                    invalidateSidebarCountsClient()
                    router.refresh()
                  })()
                },
              }
            : undefined,
      })
    },
    [token, authHeaders, router, setKeyRemoved],
  )

  const wakeRow = useCallback(
    async (row: TodayQueueRow) => {
      if (!token || row.snooze_id == null) return
      const key = rowKey(row)
      setKeyRemoved(key, true)
      const res = await fetch('/api/admin/pipeline/aging/snooze', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ snooze_id: row.snooze_id }),
      })
      if (!res.ok) {
        setKeyRemoved(key, false)
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not wake this row')
        return
      }
      toast.success(`${row.client_name ?? 'Row'} is back in the queue`)
      invalidateSidebarCountsClient()
      announceCleared()
      router.refresh()
    },
    [token, authHeaders, router, setKeyRemoved],
  )

  const nudgeMatter = useCallback(
    async (matterId: string, clientName: string | null) => {
      if (!token) {
        toast.error('Not signed in')
        return false
      }
      const res = await fetch('/api/admin/intake/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ matterId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? `Could not nudge ${clientName ?? 'client'}`)
        return false
      }
      announceCleared()
      return true
    },
    [token, authHeaders],
  )

  const nudgeRow = useCallback(
    async (row: TodayQueueRow) => {
      if (!row.nudge_matter_id) {
        router.push(rowHref(row))
        return
      }
      const ok = await nudgeMatter(row.nudge_matter_id, row.client_name)
      if (ok) toast.success(`Intake reminder sent to ${row.client_name ?? 'client'}`)
    },
    [nudgeMatter, router],
  )

  const openNudgePreview = useCallback(() => {
    if (nudgeCandidates.length === 0) {
      toast.info('No one to nudge — these rows are not waiting on an intake')
      return
    }
    setNudgePreviewOpen(true)
  }, [nudgeCandidates.length])

  const nudgeAll = useCallback(async () => {
    if (sendableNudges.length === 0) return
    setNudging(true)
    let sent = 0
    for (const row of sendableNudges) {
      if (await nudgeMatter(row.nudge_matter_id as string, row.client_name)) sent += 1
    }
    setNudging(false)
    setNudgePreviewOpen(false)
    if (sent > 0) toast.success(`Sent ${sent} intake reminder${sent === 1 ? '' : 's'}`)
  }, [sendableNudges, nudgeMatter])

  const runPrimary = useCallback(
    (row: TodayQueueRow) => {
      if (row.entity === 'lead') {
        const href = leadActionHref(row)
        if (href.startsWith('tel:')) window.location.href = href
        else router.push(href)
        return
      }
      if (row.nudge_matter_id) {
        void nudgeRow(row)
        return
      }
      router.push(row.action?.href ?? rowHref(row))
    },
    [router, nudgeRow],
  )

  const taskActions = useTaskActions()

  const overdueTaskRows = useMemo(
    () => overdueTasks.filter(t => !completedTaskIds.has(t.id)).sort(compareTasks),
    [overdueTasks, completedTaskIds],
  )
  const dueTodayTaskRows = useMemo(
    () => tasksDueToday.filter(t => !completedTaskIds.has(t.id)).sort(compareTasks),
    [tasksDueToday, completedTaskIds],
  )

  const primaryDecision = useMemo<PrimaryDecision | null>(() => {
    const overdueTask = overdueTaskRows[0]
    if (overdueTask) {
      return { kind: 'task', key: `task:${overdueTask.id}`, task: overdueTask, urgency: 'Overdue task' }
    }
    const blockingRow = blocking[0]
    if (blockingRow) {
      return { kind: 'aging', key: rowKey(blockingRow), row: blockingRow, urgency: 'Blocking a client' }
    }
    const dueTask = dueTodayTaskRows[0]
    if (dueTask) {
      return { kind: 'task', key: `task:${dueTask.id}`, task: dueTask, urgency: 'Due today' }
    }
    const thread = unreadThreads[0]
    if (thread) return { kind: 'message', key: `unread:${thread.matter_id}`, thread }
    const review = intakeReview[0]
    if (review) return { kind: 'review', key: `review:${review.matter_id}`, matter: review }
    const send = intakeToSend[0]
    if (send) return { kind: 'send', key: `send:${send.matter_id}`, matter: send }
    const queueRow = queue[0]
    if (queueRow) {
      return { kind: 'aging', key: rowKey(queueRow), row: queueRow, urgency: 'Needs attention' }
    }
    return null
  }, [overdueTaskRows, blocking, dueTodayTaskRows, unreadThreads, intakeReview, intakeToSend, queue])

  const remainingOverdueTasks = overdueTaskRows.filter(task => primaryDecision?.key !== `task:${task.id}`)
  const remainingBlocking = blocking.filter(row => primaryDecision?.key !== rowKey(row))
  const remainingDueTodayTasks = dueTodayTaskRows.filter(task => primaryDecision?.key !== `task:${task.id}`)
  const remainingUnreadThreads = unreadThreads.filter(
    thread => primaryDecision?.key !== `unread:${thread.matter_id}`,
  )
  const remainingIntakeReview = intakeReview.filter(
    matter => primaryDecision?.key !== `review:${matter.matter_id}`,
  )
  const remainingQueue = queue.filter(row => primaryDecision?.key !== rowKey(row))
  const remainingIntakeToSend = intakeToSend.filter(
    matter => primaryDecision?.key !== `send:${matter.matter_id}`,
  )
  const queueShown = queueExpanded
    ? remainingQueue
    : remainingQueue.slice(0, QUEUE_PREVIEW_COUNT)
  const queueHidden = remainingQueue.length - queueShown.length
  // Overdue work used to render every row, which was survivable while a
  // truncated read showed one of them. It is the whole backlog now — 27 rows on
  // 2026-08-24 — so it previews like every other long group on this page.
  const overdueShown = overdueExpanded
    ? remainingOverdueTasks
    : remainingOverdueTasks.slice(0, QUEUE_PREVIEW_COUNT)
  const overdueHidden = remainingOverdueTasks.length - overdueShown.length
  const laterCount = remainingQueue.length + remainingIntakeToSend.length + clientRows.length

  // Fresh server rows already exclude what was completed, so the optimistic
  // hide has to clear or a re-opened task would stay invisible.
  useEffect(() => {
    setCompletedTaskIds(prev => (prev.size === 0 ? prev : new Set()))
  }, [overdueTasks, tasksDueToday])

  const completeTask = useCallback(
    async (task: TaskRow) => {
      setCompletedTaskIds(prev => new Set(prev).add(task.id))
      const updated = await taskActions.complete(task)
      if (!updated) {
        setCompletedTaskIds(prev => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
        return
      }
      announceCleared()
      router.refresh()
    },
    [taskActions, router],
  )

  const snoozeTask = useCallback(
    async (task: TaskRow, days: number, label: string) => {
      setSnoozeMenuKey(null)
      const updated = await taskActions.snooze(task, days, label)
      if (updated) router.refresh()
    },
    [taskActions, router],
  )

  const handlers: RowHandlers = {
    snoozeMenuKey,
    setSnoozeMenuKey,
    onSnooze: (row, until, label) => void snoozeRow(row, until, label),
    onNudge: row => void nudgeRow(row),
  }

  // Ordered list of what J/K walk through on the active tab.
  const focusTargets = useMemo<FocusTarget[]>(() => {
    if (tab === 'you') {
      const agingTargets = (rows: TodayQueueRow[]) => rows.map(row => ({
        key: rowKey(row),
        run: () => runPrimary(row),
        snoozeRow: row,
        nudge: () => void nudgeRow(row),
      }))
      const taskTargets = (tasks: TaskRow[]) => tasks.map(task => ({
        key: `task:${task.id}`,
        run: () => router.push(taskHref(task)),
        complete: () => void completeTask(task),
      }))

      const primaryTarget: FocusTarget[] = primaryDecision
        ? primaryDecision.kind === 'task'
          ? taskTargets([primaryDecision.task])
          : primaryDecision.kind === 'aging'
            ? agingTargets([primaryDecision.row])
            : [{
                key: primaryDecision.key,
                run: () => router.push(
                  primaryDecision.kind === 'message'
                    ? `/admin/matters/${primaryDecision.thread.matter_id}?tab=communications`
                    : primaryDecision.kind === 'review'
                      ? `/admin/drafting/${primaryDecision.matter.matter_id}`
                      : `/admin/matters/${primaryDecision.matter.matter_id}`,
                ),
              }]
        : []

      const urgentTargets: FocusTarget[] = [
        ...taskTargets(remainingOverdueTasks),
        ...agingTargets(remainingBlocking),
        ...taskTargets(remainingDueTodayTasks),
        ...remainingUnreadThreads.map(t => ({
          key: `unread:${t.matter_id}`,
          run: () => router.push(`/admin/matters/${t.matter_id}?tab=communications`),
        })),
        ...remainingIntakeReview.map(m => ({
          key: `review:${m.matter_id}`,
          run: () => router.push(`/admin/drafting/${m.matter_id}`),
        })),
      ]
      const laterTargets: FocusTarget[] = laterOpen
        ? [
          ...agingTargets(queueShown),
          ...remainingIntakeToSend.map(m => ({
          key: `send:${m.matter_id}`,
          run: () => router.push(`/admin/matters/${m.matter_id}`),
        })),
        ]
        : []
      return [...primaryTarget, ...urgentTargets, ...laterTargets]
    }
    if (tab === 'clients') {
      return clientRowsShown.map(row => ({
        key: rowKey(row),
        run: () => runPrimary(row),
        snoozeRow: row,
        nudge: () => void nudgeRow(row),
      }))
    }
    return snoozedRows.map(row => ({
      key: rowKey(row),
      run: () => router.push(rowHref(row)),
      wake: () => void wakeRow(row),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    removedKeys,
    queueExpanded,
    laterOpen,
    clientsExpanded,
    waitingOnYou,
    waitingOnClient,
    snoozed,
    primaryDecision,
    remainingOverdueTasks,
    remainingBlocking,
    remainingDueTodayTasks,
    remainingUnreadThreads,
    remainingIntakeReview,
    remainingIntakeToSend,
    completeTask,
    router,
    runPrimary,
    nudgeRow,
    wakeRow,
  ])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      // Never steal keys from inputs, dialogs (⌘K search), or the chat panel.
      if (
        target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], aside')
      )
        return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return

      const idx = focusTargets.findIndex(t => t.key === focusKey)
      const move = (delta: number) => {
        if (focusTargets.length === 0) return
        const next = idx === -1 ? (delta > 0 ? 0 : focusTargets.length - 1) : idx + delta
        const clamped = Math.max(0, Math.min(focusTargets.length - 1, next))
        setFocusKey(focusTargets[clamped].key)
        document
          .getElementById(`today-row-${focusTargets[clamped].key}`)
          ?.scrollIntoView({ block: 'nearest' })
      }
      const focused = idx >= 0 ? focusTargets[idx] : null

      switch (e.key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault()
          move(1)
          break
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          break
        case 'e':
        case 'E':
        case 'Enter':
          if (focused?.run) {
            e.preventDefault()
            focused.run()
          }
          break
        case 's':
        case 'S':
          if (focused?.snoozeRow) {
            e.preventDefault()
            setSnoozeMenuKey(focused.key)
          }
          break
        case 'n':
        case 'N':
          if (focused?.nudge) {
            e.preventDefault()
            focused.nudge()
          }
          break
        case 'w':
        case 'W':
          if (focused?.wake) {
            e.preventDefault()
            focused.wake()
          }
          break
        case 'x':
        case 'X':
          if (focused?.complete) {
            e.preventDefault()
            focused.complete()
          }
          break
        case '1':
          e.preventDefault()
          setTab('you')
          setFocusKey(null)
          break
        case '2':
          e.preventDefault()
          setTab('clients')
          setFocusKey(null)
          break
        case '3':
          e.preventDefault()
          setTab('snoozed')
          setFocusKey(null)
          break
        case 'm':
        case 'M':
          e.preventDefault()
          if (tab === 'you') setLaterOpen(prev => !prev)
          if (tab === 'clients') setClientsExpanded(prev => !prev)
          break
        case 'Escape':
          setFocusKey(null)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusKey, tab, focusTargets])

  const youCount =
    overdueTaskRows.length + dueTodayTaskRows.length + mineAll.length + unreadThreads.length
    + intakeReview.length + intakeToSend.length

  const taskRow = (task: TaskRow) => (
    <TaskListRow
      key={task.id}
      task={task}
      focused={focusKey === `task:${task.id}`}
      pending={taskActions.isPending(task.id)}
      onComplete={() => void completeTask(task)}
      actions={
        <DropdownMenu
          open={snoozeMenuKey === `task:${task.id}`}
          onOpenChange={open => setSnoozeMenuKey(open ? `task:${task.id}` : null)}
        >
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs">
              <PauseCircle className="h-3.5 w-3.5" />
              Snooze
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs font-medium">Push due date</DropdownMenuLabel>
            {snoozeOptions().map(opt => (
              <DropdownMenuItem
                key={opt.label}
                onSelect={() => void snoozeTask(task, opt.days, opt.dateLabel)}
              >
                <span>{opt.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{opt.dateLabel}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )

  const primaryDecisionContent = (() => {
    if (!primaryDecision) return null
    if (primaryDecision.kind === 'task') {
      return (
        <ul className="divide-y divide-border">
          {taskRow(primaryDecision.task)}
        </ul>
      )
    }
    if (primaryDecision.kind === 'aging') {
      return (
        <ul>
          <AgingRow
            row={primaryDecision.row}
            focused={focusKey === primaryDecision.key}
            handlers={handlers}
          />
        </ul>
      )
    }
    if (primaryDecision.kind === 'message') {
      return (
        <ul>
          <SimpleRow
            id={primaryDecision.key}
            href={`/admin/matters/${primaryDecision.thread.matter_id}?tab=communications`}
            icon={MessageSquare}
            primary={primaryDecision.thread.client_name ?? 'Unnamed matter'}
            secondary={`${primaryDecision.thread.unread_count} unread message${primaryDecision.thread.unread_count === 1 ? '' : 's'}`}
            cta="Read & reply"
            focused={focusKey === primaryDecision.key}
          />
        </ul>
      )
    }
    const isReview = primaryDecision.kind === 'review'
    return (
      <ul>
        <SimpleRow
          id={primaryDecision.key}
          href={
            isReview
              ? `/admin/drafting/${primaryDecision.matter.matter_id}`
              : `/admin/matters/${primaryDecision.matter.matter_id}`
          }
          icon={isReview ? ClipboardCheck : Send}
          primary={primaryDecision.matter.client_name ?? 'Unnamed matter'}
          secondary={primaryDecision.matter.stage_label}
          cta={isReview ? 'Review & draft' : 'Send intake'}
          focused={focusKey === primaryDecision.key}
        />
      </ul>
    )
  })()

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          className="min-w-0 max-w-full overflow-x-auto pb-1"
          value={tab}
          onValueChange={v => {
            setTab(v as TabKey)
            setFocusKey(null)
          }}
        >
          <TabsList>
            <TabsTrigger value="you">Waiting on you ({youCount})</TabsTrigger>
            <TabsTrigger value="clients">Waiting on clients ({clientRows.length})</TabsTrigger>
            <TabsTrigger value="snoozed">Snoozed ({snoozedRows.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-micro text-muted-foreground lg:inline-flex">
            <kbd className="rounded border border-border bg-muted px-1">J</kbd>
            <kbd className="rounded border border-border bg-muted px-1">K</kbd>
            move
            <kbd className="rounded border border-border bg-muted px-1">E</kbd>
            act
            <kbd className="rounded border border-border bg-muted px-1">X</kbd>
            complete
            <kbd className="rounded border border-border bg-muted px-1">S</kbd>
            snooze
            <kbd className="rounded border border-border bg-muted px-1">N</kbd>
            nudge
          </span>
          <Link
            href="/admin/pipeline/aging"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Aging
          </Link>
        </div>
      </div>

      {tab === 'you' && (
        <div>
          {primaryDecision && (
            <section
              role="region"
              aria-labelledby="today-primary-heading"
              className="mt-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/5"
            >
              <header className="flex items-center justify-between gap-3 border-b border-primary/15 px-4 py-3">
                <div>
                  <h2 id="today-primary-heading" className="text-base font-semibold text-foreground">
                    Up next
                  </h2>
                </div>
                <Badge variant="outline" className="border-primary/25 bg-background text-xs">
                  {primaryDecision.kind === 'task' || primaryDecision.kind === 'aging'
                    ? primaryDecision.urgency
                    : primaryDecision.kind === 'message'
                      ? 'Client message'
                      : primaryDecision.kind === 'review'
                        ? 'Ready for review'
                        : 'Intake to send'}
                </Badge>
              </header>
              {primaryDecisionContent}
            </section>
          )}

          {remainingOverdueTasks.length > 0 && (
            <>
              <GroupHeader title="Overdue work" count={remainingOverdueTasks.length} />
              <ul className="divide-y divide-border rounded-xl border border-border border-l-[3px] border-l-destructive bg-card">
                {overdueShown.map(taskRow)}
                {overdueHidden > 0 && (
                  <li>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setOverdueExpanded(true)}
                    >
                      Show {overdueHidden} more
                    </button>
                  </li>
                )}
              </ul>
            </>
          )}

          {remainingBlocking.length > 0 && (
            <>
              <GroupHeader title="Blocking a client" count={remainingBlocking.length} />
              <ul className="space-y-2">
                {remainingBlocking.map(row => (
                  <li
                    key={rowKey(row)}
                    className="overflow-hidden rounded-xl border border-border border-l-[3px] border-l-destructive bg-card"
                  >
                    <ul>
                      <AgingRow row={row} focused={focusKey === rowKey(row)} handlers={handlers} />
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}

          {remainingDueTodayTasks.length > 0 && (
            <>
              <GroupHeader title="Due today" count={remainingDueTodayTasks.length} />
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {remainingDueTodayTasks.map(taskRow)}
              </ul>
            </>
          )}

          {remainingUnreadThreads.length > 0 && (
            <>
              <GroupHeader title="Unread client messages" count={remainingUnreadThreads.length} />
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {remainingUnreadThreads.map(t => (
                  <SimpleRow
                    key={t.matter_id}
                    id={`unread:${t.matter_id}`}
                    href={`/admin/matters/${t.matter_id}?tab=communications`}
                    icon={MessageSquare}
                    primary={t.client_name ?? 'Unnamed matter'}
                    secondary={`${t.unread_count} unread message${t.unread_count === 1 ? '' : 's'}`}
                    cta="Read & reply"
                    focused={focusKey === `unread:${t.matter_id}`}
                  />
                ))}
              </ul>
            </>
          )}

          {remainingIntakeReview.length > 0 && (
            <>
              <GroupHeader title="Intake ready for review" count={remainingIntakeReview.length} />
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {remainingIntakeReview.map(m => (
                  <SimpleRow
                    key={m.matter_id}
                    id={`review:${m.matter_id}`}
                    href={`/admin/drafting/${m.matter_id}`}
                    icon={ClipboardCheck}
                    primary={m.client_name ?? 'Unnamed matter'}
                    secondary={m.stage_label}
                    cta="Review & draft"
                    focused={focusKey === `review:${m.matter_id}`}
                  />
                ))}
              </ul>
            </>
          )}

          {laterCount > 0 && (
            <Collapsible open={laterOpen} onOpenChange={setLaterOpen} className="mt-3">
              <div className="flex items-center gap-2">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-0 flex-1 justify-between bg-card"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden />
                      Later
                      <Badge variant="secondary" className="text-micro">{laterCount}</Badge>
                    </span>
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', laterOpen && 'rotate-180')}
                      aria-hidden
                    />
                  </Button>
                </CollapsibleTrigger>
                {clientRows.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={nudging}
                    onClick={openNudgePreview}
                  >
                    <BellRing className="h-4 w-4" />
                    Nudge all
                  </Button>
                )}
              </div>
              <CollapsibleContent className="space-y-3 pt-2">
                {remainingQueue.length > 0 && (
                  <div>
                    <GroupHeader title="Queue" count={remainingQueue.length} />
                    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                      {queueShown.map(row => (
                        <AgingRow
                          key={rowKey(row)}
                          row={row}
                          focused={focusKey === rowKey(row)}
                          handlers={handlers}
                        />
                      ))}
                      {queueHidden > 0 && (
                        <li>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => setQueueExpanded(true)}
                          >
                            Show {queueHidden} more
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {remainingIntakeToSend.length > 0 && (
                  <div>
                    <GroupHeader title="Intake to send" count={remainingIntakeToSend.length} />
                    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                      {remainingIntakeToSend.map(m => (
                        <SimpleRow
                          key={m.matter_id}
                          id={`send:${m.matter_id}`}
                          href={`/admin/matters/${m.matter_id}`}
                          icon={Send}
                          primary={m.client_name ?? 'Unnamed matter'}
                          secondary={m.stage_label}
                          cta="Send intake"
                          focused={focusKey === `send:${m.matter_id}`}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                {clientRows.length > 0 && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                      onClick={() => setTab('clients')}
                    >
                      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">
                        {clientRows.length} waiting on client{clientRows.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">Client tab</span>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {youCount === 0 && (
            <p className="px-1 pt-3 text-sm text-muted-foreground">
              Nothing is waiting on you. Check the client tab or enjoy the quiet.
            </p>
          )}
        </div>
      )}

      {tab === 'clients' && (
        <div>
          <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Waiting on clients
            </h2>
            {clientRows.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={nudging}
                onClick={openNudgePreview}
              >
                <BellRing className="h-3.5 w-3.5" />
                Nudge all
              </Button>
            )}
          </div>
          {clientRows.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">
              No at-risk rows are waiting on a client.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {clientRowsShown.map(row => (
                <AgingRow
                  key={rowKey(row)}
                  row={row}
                  focused={focusKey === rowKey(row)}
                  handlers={handlers}
                />
              ))}
              {!clientsExpanded && clientRows.length > QUEUE_PREVIEW_COUNT && (
                <li>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setClientsExpanded(true)}
                  >
                    Show {clientRows.length - QUEUE_PREVIEW_COUNT} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {tab === 'snoozed' && (
        <div>
          <GroupHeader title="Snoozed" count={snoozedRows.length} />
          {snoozedRows.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">Nothing is snoozed.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {snoozedRows.map(row => (
                <li
                  key={rowKey(row)}
                  id={`today-row-${rowKey(row)}`}
                  className={cn(
                    'grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-3 p-4 transition-colors duration-150 ease-out motion-reduce:transition-none hover:bg-accent sm:flex sm:items-center',
                    focusClass(focusKey === rowKey(row)),
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <Link
                      href={rowHref(row)}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {row.client_name ?? `Unnamed ${row.entity}`}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {engineStageLabel(row.current_stage)}
                      {row.snoozed_until &&
                        ` · snoozed until ${SNOOZE_DATE.format(new Date(row.snoozed_until))}`}
                      {row.snooze_reason && ` · ${row.snooze_reason}`}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => void wakeRow(row)}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Wake now
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AlertDialog open={nudgePreviewOpen} onOpenChange={setNudgePreviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Review intake reminders</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm who will receive an email reminder before anything is sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
            <ul className="divide-y divide-border">
              {nudgeCandidates.map(row => (
                <li key={rowKey(row)} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {row.client_name ?? 'Unnamed client'}
                    </span>
                    {row.client_email ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.client_email}
                      </span>
                    ) : (
                      <span className="block text-xs text-amber-orange">
                        No email on file — skipped
                      </span>
                    )}
                  </span>
                  {row.client_email && (
                    <Badge variant="secondary" className="shrink-0 gap-1 text-micro">
                      <Mail className="h-3 w-3" aria-hidden />
                      Email
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {skippedNudges.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {skippedNudges.length} client{skippedNudges.length === 1 ? '' : 's'} will be skipped because no email address is available.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={nudging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={nudging || sendableNudges.length === 0}
              onClick={event => {
                event.preventDefault()
                void nudgeAll()
              }}
            >
              {nudging
                ? 'Sending…'
                : `Send ${sendableNudges.length} email${sendableNudges.length === 1 ? '' : 's'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(queueExpanded || clientsExpanded) && (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            setQueueExpanded(false)
            setClientsExpanded(false)
          }}
        >
          <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
          Collapse
        </button>
      )}
    </div>
  )
}
