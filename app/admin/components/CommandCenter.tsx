'use client'

import { useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  Clock3,
  ExternalLink,
  Focus,
  Loader2,
  MessageSquare,
  PauseCircle,
  Play,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import type { DailyPlanPreview, WorkItem, WorkPreferences } from '@/lib/work/types'
import type { DailyPlanStatus } from '@/lib/work/plans'
import type { DailyPlanCalendarStatus, DailyPlanCalendarSyncResult } from '@/lib/work/dailyPlanCalendar'
import type { EndOfDayClosePreview, EndOfDayWorkItem } from '@/lib/work/endOfDay'
import { itemsExceptNow } from '@/lib/work/presentation'
import { selectCommittedFocusItem, type CommittedFocusPlanItem } from '@/lib/work/committedFocus'

type CommandCenterPlan = {
  id: string
  status: DailyPlanStatus
  calendarStatus: DailyPlanCalendarStatus | null
  items: CommittedFocusPlanItem[]
}

interface Props {
  initialPreview: DailyPlanPreview
  preferences: WorkPreferences
  initialPlan: CommandCenterPlan | null
  sourceErrors: string[]
}

const BAND_LABEL = ['Critical', 'Must do', 'Soon', 'Planned', 'Waiting'] as const

function PlanningPreferences({
  value,
  onSaved,
}: {
  value: WorkPreferences
  onSaved: (preferences: WorkPreferences) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/me/work-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await response.json().catch(() => ({})) as { preferences?: WorkPreferences; error?: string }
      if (!response.ok || !body.preferences) throw new Error(body.error ?? 'Preferences could not be saved')
      await onSaved(body.preferences)
      setOpen(false)
      toast.success('Planning preferences saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preferences could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const numberField = (key: keyof WorkPreferences) => (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(current => ({ ...current, [key]: Number(event.target.value) }))
  }

  return (
    <Dialog open={open} onOpenChange={next => {
      setOpen(next)
      if (next) setDraft(value)
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Settings2 /> Planning preferences</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Planning preferences</DialogTitle>
          <DialogDescription>Set guardrails that keep the plan realistic and reduce overload.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="max-must-do">Must-do limit</Label><Input id="max-must-do" type="number" min={1} max={10} value={draft.maxMustDo} onChange={numberField('maxMustDo')} /></div>
          <div className="space-y-1.5"><Label htmlFor="focus-capacity">Focus capacity (minutes)</Label><Input id="focus-capacity" type="number" min={30} max={720} step={15} value={draft.focusCapacityMinutes} onChange={numberField('focusCapacityMinutes')} /></div>
          <div className="space-y-1.5"><Label htmlFor="interrupt-buffer">Interruption buffer (%)</Label><Input id="interrupt-buffer" type="number" min={0} max={60} step={5} value={draft.interruptionBufferPercent} onChange={numberField('interruptionBufferPercent')} /></div>
          <div className="space-y-1.5"><Label htmlFor="focus-block">Default focus block</Label><Input id="focus-block" type="number" min={15} max={120} step={5} value={draft.focusBlockMinutes} onChange={numberField('focusBlockMinutes')} /></div>
          <div className="space-y-1.5"><Label htmlFor="max-focus-block">Maximum focus block</Label><Input id="max-focus-block" type="number" min={15} max={180} step={5} value={draft.maxFocusBlockMinutes} onChange={numberField('maxFocusBlockMinutes')} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-batch">Administrative batch</Label>
            <NativeSelect id="admin-batch" value={String(draft.adminBatchMinutes)} onChange={event => setDraft(current => ({ ...current, adminBatchMinutes: Number(event.target.value) as 15 | 30 }))}>
              <option value="15">15 minutes</option><option value="30">30 minutes</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5"><Label htmlFor="workday-start">Workday starts</Label><Input id="workday-start" type="time" value={draft.workdayStart} onChange={event => setDraft(current => ({ ...current, workdayStart: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="workday-end">Workday ends</Label><Input id="workday-end" type="time" value={draft.workdayEnd} onChange={event => setDraft(current => ({ ...current, workdayEnd: event.target.value }))} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save preferences</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function formatBlock(iso: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

function assistantHref(item: WorkItem) {
  const params = new URLSearchParams()
  if (item.record.type === 'matter' && item.record.id) params.set('matter', item.record.id)
  if (item.record.type === 'lead' && item.record.id) params.set('lead', item.record.id)
  return `/admin/assistant${params.size ? `?${params}` : ''}`
}

async function recordUsage(event: 'work_snoozed' | 'work_blocked') {
  try {
    await fetch('/api/admin/command-center/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      keepalive: true,
    })
  } catch {
    // Aggregate rollout telemetry must never block the underlying work action.
  }
}

type TaskAssignee = { id: string; name: string }

async function executeTodayInternalAction(input: {
  actionKey: string
  referencePayload: Record<string, unknown>
  displaySummary: string
  item: WorkItem
}) {
  const proposed = await fetch('/api/admin/actions/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actionKey: input.actionKey,
      referencePayload: input.referencePayload,
      displaySummary: input.displaySummary,
      recordType: input.item.record.type,
      recordId: input.item.record.id,
      source: 'today',
    }),
  })
  const proposedBody = await proposed.json().catch(() => ({})) as {
    proposal?: { id: string }
    error?: string
  }
  if (!proposed.ok || !proposedBody.proposal) throw new Error(proposedBody.error ?? 'The action could not be prepared')

  const executed = await fetch(`/api/admin/actions/proposals/${proposedBody.proposal.id}/execute`, { method: 'POST' })
  const executedBody = await executed.json().catch(() => ({})) as { error?: string }
  if (!executed.ok) throw new Error(executedBody.error ?? 'The action could not be completed')
}

function DelegateTaskButton({ item, onDelegated }: { item: WorkItem; onDelegated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [assignees, setAssignees] = useState<TaskAssignee[] | null>(null)
  const [assigneeId, setAssigneeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function changeOpen(next: boolean) {
    setOpen(next)
    if (!next || assignees) return
    setLoading(true)
    try {
      const response = await fetch('/api/admin/tasks/assignees', { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { assignees?: TaskAssignee[]; error?: string }
      if (!response.ok || !body.assignees) throw new Error(body.error ?? 'Staff list could not be loaded')
      setAssignees(body.assignees)
      setAssigneeId(current => current || body.assignees?.[0]?.id || '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Staff list could not be loaded')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function delegate() {
    const assignee = assignees?.find(person => person.id === assigneeId)
    const taskId = item.sourceIds[0]
    if (!assignee || !taskId) return
    setSaving(true)
    try {
      await executeTodayInternalAction({
        actionKey: 'task.delegate',
        referencePayload: { taskId, assigneeId: assignee.id },
        displaySummary: `Delegate task: ${item.title} to ${assignee.name}`,
        item,
      })
      await onDelegated()
      setOpen(false)
      toast.success(`Delegated to ${assignee.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delegate this task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 px-2 text-xs" variant="ghost"><Users /> Delegate</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delegate task</DialogTitle>
          <DialogDescription>Assign “{item.title}” to an authorized staff member. This is an internal, auditable change.</DialogDescription>
        </DialogHeader>
        {loading ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Loading staff…</div> : (
          <div className="space-y-2 py-2">
            <Label htmlFor={`delegate-${item.workKey}`}>Assign to</Label>
            <NativeSelect id={`delegate-${item.workKey}`} value={assigneeId} onChange={event => setAssigneeId(event.target.value)} disabled={!assignees?.length || saving}>
              {assignees?.length
                ? assignees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)
                : <option value="">No eligible staff members</option>}
            </NativeSelect>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={delegate} disabled={loading || saving || !assigneeId}>
            {saving ? <Loader2 className="animate-spin" /> : <Users />} Delegate task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkCard({
  item,
  primary = false,
  planId,
  openedAtRef,
  onRefresh,
}: {
  item: WorkItem
  primary?: boolean
  planId: string | null
  openedAtRef: RefObject<number>
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function planStatus(status: 'started' | 'completed') {
    if (!planId) return
    const response = await fetch(`/api/admin/daily-plans/${planId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: { workKey: item.workKey, status },
        choiceDurationSeconds: status === 'started' ? Math.round((Date.now() - openedAtRef.current) / 1000) : undefined,
      }),
    })
    if (!response.ok) throw new Error('The daily plan could not be updated')
  }

  async function start() {
    setBusy('start')
    try {
      if (item.sourceType === 'task') {
        await executeTodayInternalAction({
          actionKey: 'task.start', referencePayload: { taskId: item.sourceIds[0] }, displaySummary: `Start task: ${item.title}`, item,
        })
      }
      await planStatus('started')
      await onRefresh()
      toast.success('Marked in progress')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start this work')
    } finally {
      setBusy(null)
    }
  }

  async function done() {
    setBusy('done')
    try {
      if (item.sourceType === 'task') {
        await executeTodayInternalAction({
          actionKey: 'task.complete', referencePayload: { taskId: item.sourceIds[0] }, displaySummary: `Complete task: ${item.title}`, item,
        })
      } else {
        // Non-task items represent external state (an unread message, intake,
        // invoice, etc.). Opening and resolving that source is the only honest
        // completion path; a local checkmark must not hide unfinished work.
        toast.info('Resolve this in its source record; Cornerstone will clear it automatically.')
        return
      }
      await planStatus('completed')
      await onRefresh()
      toast.success('Completed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to complete this work')
    } finally {
      setBusy(null)
    }
  }

  async function override(state: 'snoozed' | 'blocked') {
    setBusy(state)
    try {
      const snoozedUntil = state === 'snoozed'
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null
      await executeTodayInternalAction({
        actionKey: 'work.override',
        referencePayload: { workKey: item.workKey, state, snoozedUntil },
        displaySummary: `${state === 'snoozed' ? 'Snooze' : 'Block'} work: ${item.title}`,
        item,
      })
      await recordUsage(state === 'snoozed' ? 'work_snoozed' : 'work_blocked')
      await onRefresh()
      toast.success(state === 'snoozed' ? 'Snoozed for one day' : 'Moved to blocked')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this work')
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className={cn(
      'rounded-xl border bg-card p-4 shadow-sm',
      primary && 'border-primary/40 bg-primary/[0.035] p-5',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.priorityBand === 0 ? 'destructive' : 'secondary'}>
              {BAND_LABEL[item.priorityBand]}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatMinutes(item.estimateMinutes)}</span>
            <span className="truncate text-xs text-muted-foreground">{item.record.name}</span>
          </div>
          <h3 className={cn('mt-2 font-semibold text-foreground', primary ? 'text-lg' : 'text-sm')}>
            {item.title}
          </h3>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.priorityReasons.slice(0, 2).map(reason => (
              <li key={reason.code} className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
                {reason.label}
              </li>
            ))}
          </ul>
        </div>
        <Button asChild size="sm">
          <Link href={item.href}>{item.actionLabel}<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
        <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={start} disabled={busy !== null || !planId}>
          {busy === 'start' ? <Loader2 className="animate-spin" /> : <Play />} Start
        </Button>
        <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={done} disabled={busy !== null}>
          {busy === 'done' ? <Loader2 className="animate-spin" /> : <Check />} Done
        </Button>
        <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={() => override('snoozed')} disabled={busy !== null}>
          {busy === 'snoozed' ? <Loader2 className="animate-spin" /> : <Clock3 />} Snooze
        </Button>
        <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={() => override('blocked')} disabled={busy !== null}>
          {busy === 'blocked' ? <Loader2 className="animate-spin" /> : <PauseCircle />} Blocked
        </Button>
        {item.sourceType === 'task'
          ? <DelegateTaskButton item={item} onDelegated={onRefresh} />
          : <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" disabled title="Only task work can be delegated directly"><Users /> Delegate</Button>}
        <Button asChild size="sm" className="h-7 px-2 text-xs" variant="ghost">
          <Link href={assistantHref(item)}><Bot /> Ask Cornerstone</Link>
        </Button>
        {item.evidence.length > 1 && (
          <span className="ml-auto self-center text-micro text-muted-foreground">
            {item.evidence.length} sources combined
          </span>
        )}
      </div>
    </article>
  )
}

function WorkList({
  items,
  empty,
  planId,
  openedAtRef,
  onRefresh,
}: {
  items: WorkItem[]
  empty: string
  planId: string | null
  openedAtRef: RefObject<number>
  onRefresh: () => Promise<void>
}) {
  if (!items.length) return <p className="py-5 text-center text-sm text-muted-foreground">{empty}</p>
  return <div className="space-y-2">{items.map(item => (
    <WorkCard key={item.workKey} item={item} planId={planId} openedAtRef={openedAtRef} onRefresh={onRefresh} />
  ))}</div>
}

function CloseReviewList({
  items,
  empty,
}: {
  items: EndOfDayWorkItem[]
  empty: string
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map(item => (
        <li key={item.workKey} className="flex items-start gap-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
          {item.href ? <Link className="text-primary underline-offset-4 hover:underline" href={item.href}>{item.title}</Link> : <span>{item.title}</span>}
        </li>
      ))}
    </ul>
  )
}

function EndOfDayClose({
  plan,
  disabled,
  onClosed,
}: {
  plan: { id: string; status: DailyPlanStatus } | null
  disabled: boolean
  onClosed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<EndOfDayClosePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState(false)

  async function loadPreview() {
    if (!plan) return
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/daily-plans/${plan.id}/close-preview`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { preview?: EndOfDayClosePreview; error?: string }
      if (!response.ok || !body.preview) throw new Error(body.error ?? 'The close review could not be loaded')
      setPreview(body.preview)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The close review could not be loaded')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function changeOpen(next: boolean) {
    setOpen(next)
    if (next) {
      setPreview(null)
      await loadPreview()
    }
  }

  async function closePlan() {
    if (!plan) return
    setClosing(true)
    try {
      const response = await fetch(`/api/admin/daily-plans/${plan.id}/close`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { plan?: { status?: DailyPlanStatus }; error?: string }
      if (!response.ok || body.plan?.status !== 'closed') throw new Error(body.error ?? 'The daily plan could not be closed')
      setOpen(false)
      onClosed()
      toast.success('Day closed. Unfinished work remains open for your next plan.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The daily plan could not be closed')
    } finally {
      setClosing(false)
    }
  }

  if (!plan || plan.status !== 'committed') return null
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>Close day</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>End-of-day close</DialogTitle>
          <DialogDescription>
            Review the day before closing it. This never completes, deletes, or reschedules unfinished source work.
          </DialogDescription>
        </DialogHeader>
        {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Preparing your review…</div> : preview && (
          <div className="space-y-5 py-2">
            <section>
              <h3 className="text-sm font-semibold">Completed · {preview.completed.length}</h3>
              <div className="mt-2"><CloseReviewList items={preview.completed} empty="No work is recorded complete in this plan." /></div>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Carry forward · {preview.interrupted.length + preview.blocked.length + preview.snoozed.length}</h3>
              <p className="mt-1 text-xs text-muted-foreground">These items stay open with their original source deadlines and ownership.</p>
              <div className="mt-2 space-y-3">
                <CloseReviewList items={preview.interrupted} empty="No unfinished planned work." />
                {preview.blocked.length > 0 && <CloseReviewList items={preview.blocked} empty="" />}
                {preview.snoozed.length > 0 && <CloseReviewList items={preview.snoozed} empty="" />}
              </div>
            </section>
            {preview.newCritical.length > 0 && <section>
              <h3 className="text-sm font-semibold text-destructive">New critical work · {preview.newCritical.length}</h3>
              <div className="mt-2"><CloseReviewList items={preview.newCritical} empty="" /></div>
            </section>}
            <section>
              <h3 className="text-sm font-semibold">Unresolved risks</h3>
              <div className="mt-2"><CloseReviewList items={preview.unresolvedRisks} empty="No critical or must-do risk is currently open." /></div>
            </section>
            <section className="rounded-lg border bg-muted p-3">
              <h3 className="text-sm font-semibold">Tomorrow’s first action</h3>
              <p className="mt-1 text-xs text-muted-foreground">A suggestion from the current deterministic ranking; it does not create tomorrow’s plan.</p>
              <div className="mt-2"><CloseReviewList items={preview.tomorrowFirstAction ? [preview.tomorrowFirstAction] : []} empty="No firm-owned open work is currently ranked." /></div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={closing}>Keep plan open</Button>
          <Button onClick={closePlan} disabled={!preview || loading || closing}>
            {closing ? <Loader2 className="animate-spin" /> : <Check />} Close day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CommandCenter({ initialPreview, preferences, initialPlan, sourceErrors }: Props) {
  const openedAtMs = useRef(Date.now())
  const [preview, setPreview] = useState(initialPreview)
  const [workPreferences, setWorkPreferences] = useState(preferences)
  const [plan, setPlan] = useState(initialPlan)
  const [focusMode, setFocusMode] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const blockItems = useMemo(() => {
    const all = [...preview.mustDo, ...preview.suggested, ...preview.communication]
    return new Map(all.map(item => [item.workKey, item]))
  }, [preview])
  // `now` points at an item in one of the plan lanes. Render that obligation
  // once, as the prominent next action, instead of making an ADHD user decide
  // whether two identical cards represent two separate commitments.
  const visibleMustDo = itemsExceptNow(preview.mustDo, preview.now)
  const visibleCommunication = itemsExceptNow(preview.communication, preview.now)
  const visibleSuggested = itemsExceptNow(preview.suggested, preview.now)
  const focusItem = selectCommittedFocusItem(preview, plan)

  async function refresh() {
    const [response, storedResponse] = await Promise.all([
      fetch(`/api/admin/work-items?date=${encodeURIComponent(preview.date)}`, { cache: 'no-store' }),
      fetch(`/api/admin/daily-plans/current?date=${encodeURIComponent(preview.date)}`, { cache: 'no-store' }),
    ])
    const [body, storedBody] = await Promise.all([
      response.json().catch(() => ({})) as Promise<{ plan?: DailyPlanPreview; preferences?: WorkPreferences; error?: string }>,
      storedResponse.json().catch(() => ({})) as Promise<{ plan?: Omit<CommandCenterPlan, 'calendarStatus'>; error?: string }>,
    ])
    if (!response.ok || !body.plan) throw new Error(body.error ?? 'The command center could not refresh')
    setPreview(body.plan)
    if (body.preferences) setWorkPreferences(body.preferences)
    if (storedResponse.ok) {
      setPlan(current => storedBody.plan
        ? { ...storedBody.plan, calendarStatus: current?.id === storedBody.plan.id ? current.calendarStatus : null }
        : null)
    }
  }

  async function generate() {
    setBusy('generate')
    try {
      const response = await fetch('/api/admin/daily-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: preview.date }),
      })
      const body = await response.json().catch(() => ({})) as {
        plan?: Omit<CommandCenterPlan, 'calendarStatus'>
        preview?: DailyPlanPreview
        calendarStatus?: DailyPlanCalendarStatus
        error?: string
      }
      if (!response.ok || !body.plan || !body.preview) throw new Error(body.error ?? 'The plan could not be generated')
      setPlan({ ...body.plan, calendarStatus: body.calendarStatus ?? null })
      setPreview(body.preview)
      toast.success('Draft day created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The plan could not be generated')
    } finally {
      setBusy(null)
    }
  }

  async function commit() {
    if (!plan) return
    setBusy('commit')
    try {
      const response = await fetch(`/api/admin/daily-plans/${plan.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planningDurationSeconds: Math.round((Date.now() - openedAtMs.current) / 1000),
        }),
      })
      const body = await response.json().catch(() => ({})) as {
        plan?: { status: DailyPlanStatus }
        calendarSync?: DailyPlanCalendarSyncResult | null
        calendarSyncError?: string | null
        error?: string
      }
      if (!response.ok || !body.plan) throw new Error(body.error ?? 'The plan could not be committed')
      setPlan(current => current ? {
        ...current,
        status: body.plan!.status,
        calendarStatus: body.calendarSync ?? current.calendarStatus,
      } : current)
      if (body.calendarSyncError) {
        toast.warning(`Plan committed. Calendar needs attention: ${body.calendarSyncError}`)
      } else if (body.calendarSync && (body.calendarSync.pendingBlocks > 0 || body.calendarSync.staleBlocks > 0)) {
        toast.warning(`Plan committed. ${body.calendarSync.syncedBlocks} of ${body.calendarSync.desiredBlocks} calendar blocks synced.`)
      } else {
        toast.success(body.calendarSync?.desiredBlocks
          ? `Plan committed and ${body.calendarSync.syncedBlocks} calendar blocks reserved`
          : 'Today’s plan is committed')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The plan could not be committed')
    } finally {
      setBusy(null)
    }
  }

  async function syncCalendar() {
    if (!plan) return
    setBusy('calendar-sync')
    try {
      const response = await fetch(`/api/admin/daily-plans/${plan.id}/calendar-sync`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as {
        calendarSync?: DailyPlanCalendarSyncResult
        error?: string
      }
      if (!response.ok || !body.calendarSync) throw new Error(body.error ?? 'Calendar blocks could not be synced')
      setPlan(current => current ? { ...current, calendarStatus: body.calendarSync! } : current)
      if (body.calendarSync.pendingBlocks > 0 || body.calendarSync.staleBlocks > 0) {
        toast.warning(`${body.calendarSync.syncedBlocks} of ${body.calendarSync.desiredBlocks} calendar blocks synced. Retry after resolving conflicts.`)
      } else {
        toast.success(`${body.calendarSync.syncedBlocks} calendar blocks are reserved`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Calendar blocks could not be synced')
    } finally {
      setBusy(null)
    }
  }

  if (focusMode && focusItem) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Focus mode</p>
            <h2 className="text-2xl font-semibold">Only the next step</h2>
          </div>
          <Button variant="outline" onClick={() => setFocusMode(false)}>View full plan</Button>
        </div>
        <WorkCard item={focusItem} primary planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
        <p className="text-center text-xs text-muted-foreground">
          The rest of the queue is still safe. Finish, snooze, or block this item to reveal the next one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span><strong>{formatMinutes(preview.plannedMinutes)}</strong> planned</span>
          <span className="text-muted-foreground">{formatMinutes(preview.capacityMinutes)} available after {workPreferences.interruptionBufferPercent}% buffer</span>
          {plan && <Badge variant="outline" className="capitalize">{plan.status}</Badge>}
          {plan?.status === 'committed' && plan.calendarStatus && plan.calendarStatus.desiredBlocks > 0 && (
            <span className={cn(
              'inline-flex items-center gap-1 text-xs',
              plan.calendarStatus.pendingBlocks || plan.calendarStatus.staleBlocks
                ? 'text-amber-strong'
                : 'text-green',
            )}>
              <CalendarClock className="size-3.5" aria-hidden />
              {plan.calendarStatus.syncedBlocks}/{plan.calendarStatus.desiredBlocks} calendar blocks reserved
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <PlanningPreferences value={workPreferences} onSaved={async next => { setWorkPreferences(next); await refresh() }} />
          <Button variant="outline" size="sm" onClick={() => setFocusMode(true)} disabled={!focusItem}>
            <Focus /> Focus now
          </Button>
          <Button variant="outline" size="sm" onClick={generate} disabled={busy !== null}>
            {busy === 'generate' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {plan?.status === 'closed' ? 'Create new draft' : plan ? 'Replan' : 'Create draft plan'}
          </Button>
          <Button size="sm" onClick={commit} disabled={!plan || plan.status !== 'draft' || busy !== null}>
            {busy === 'commit' ? <Loader2 className="animate-spin" /> : <Check />}
            Commit plan
          </Button>
          <EndOfDayClose
            plan={plan}
            disabled={busy !== null}
            onClosed={() => setPlan(current => current ? { ...current, status: 'closed' } : current)}
          />
          {plan?.status === 'committed'
            && (!plan.calendarStatus || plan.calendarStatus.pendingBlocks > 0 || plan.calendarStatus.staleBlocks > 0) && (
              <Button size="sm" variant="outline" onClick={syncCalendar} disabled={busy !== null}>
                {busy === 'calendar-sync' ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                Retry calendar
              </Button>
            )}
        </div>
      </div>

      {preview.overload && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-semibold text-foreground">Today is over capacity by {formatMinutes(preview.overloadMinutes)}.</p>
            <p className="mt-1 text-muted-foreground">Do not hide the conflict. Defer, delegate, or reschedule one of the must-do items below.</p>
          </div>
        </div>
      )}

      {sourceErrors.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-border bg-amber-bg/50 px-3 py-2 text-xs text-amber-strong">
          Some sources could not be refreshed: {sourceErrors.join(', ')}. Visible work is still usable, but the plan may be incomplete.
        </div>
      )}

      <section aria-labelledby="now-heading">
        <div className="mb-2 flex items-center gap-2">
          <Focus className="h-4 w-4 text-primary" aria-hidden />
          <h2 id="now-heading" className="text-base font-semibold">Now</h2>
        </div>
        {preview.now
          ? <WorkCard item={preview.now} primary planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
          : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No firm-owned work needs attention.</CardContent></Card>}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Must do</CardTitle>
              <CardDescription>Critical work is never hidden; otherwise this list stops at {workPreferences.maxMustDo}.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkList items={visibleMustDo} empty="No additional must-do items." planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> Communication batch</CardTitle>
              <CardDescription>{visibleCommunication.length} replies grouped into a {workPreferences.adminBatchMinutes}-minute admin block.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkList items={visibleCommunication} empty="No additional replies waiting." planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
              <Button asChild variant="link" size="sm" className="mt-2 px-0">
                <Link href="/admin/communications">Open all communications <ExternalLink /></Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Suggested next</CardTitle>
              <CardDescription>Important work that fits the remaining capacity.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkList items={visibleSuggested} empty="No additional work fits today’s capacity." planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" /> Suggested day</CardTitle>
              <CardDescription>Focus blocks avoid recorded appointments and keep ten-minute transitions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.blocks.length ? preview.blocks.map(block => {
                const item = blockItems.get(block.workKey)
                return (
                  <div key={block.workKey} className="flex gap-3 rounded-lg border px-3 py-2 text-sm">
                    <span className="shrink-0 font-medium tabular-nums">{formatBlock(block.startAt)}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{item?.title ?? 'Communication batch'}</span>
                  </div>
                )
              }) : <p className="text-sm text-muted-foreground">No focus blocks fit the remaining workday.</p>}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/admin/calendar">Review calendar</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Waiting or blocked</CardTitle>
              <CardDescription>Visible for context, excluded from Focus Mode.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkList items={preview.waiting.slice(0, 8)} empty="Nothing is waiting or blocked." planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
              {preview.waiting.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+ {preview.waiting.length - 8} more</p>}
            </CardContent>
          </Card>

          <details className="rounded-xl border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">Later · {preview.later.length}</summary>
            <div className="mt-3">
              <WorkList items={preview.later} empty="Nothing deferred." planId={plan?.id ?? null} openedAtRef={openedAtMs} onRefresh={refresh} />
            </div>
          </details>
        </aside>
      </div>
    </div>
  )
}
