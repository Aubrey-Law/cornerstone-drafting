'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Briefcase,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ListChecks,
  PauseCircle,
  PlayCircle,
  ReceiptText,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatFirmDate } from '@/lib/format'
import { dueTone, type SlaDueTone, type SlaProgress } from '@/lib/slaTasks/schedule'
import { SLA_PHASES, SLA_PHASE_LABEL, type PlanTask, type SlaPhase } from '@/lib/slaTasks/types'
import { TASK_SOURCE_LABEL, isTaskSkipped } from '@/lib/tasks/types'
import { cn } from '@/lib/utils'

/**
 * The status values the plan's menu offers. 'skipped' is not a task status —
 * the API turns it into `archived` with `skipped_at` set — but it is a distinct
 * choice here, because skipping a task as not applicable and abandoning it mean
 * different things to the plan.
 */
type PlanStatusChoice = 'open' | 'in_progress' | 'done' | 'skipped' | 'blocked'

/** The matter a plan belongs to, as the plan API reports it. */
interface PlanMatter {
  id: string
  name: string | null
}

interface TaskPlanViewProps {
  matterId: string
  /** False until the view is first opened, so its data loads lazily. */
  enabled: boolean
  /** Called after any change, so the tab badge and queue can refresh. */
  onTasksChanged?: () => void
  /**
   * Show which matter each task belongs to, linked. On by default. A plan is
   * reachable from a lead as well as from the matter that owns it, and from the
   * lead nothing else on the row says whose plan this is. The link targets the
   * matter record rather than this view, so it is a real move even when the
   * plan is already open on that matter.
   */
  showMatter?: boolean
}

const OWNER_LABEL: Record<string, string> = {
  firm: 'firm',
  client: 'client',
  automation: 'automation',
}

const TONE_CLASS: Record<SlaDueTone, string> = {
  done: 'text-muted-foreground',
  overdue: 'text-red-strong font-medium',
  soon: 'text-amber-strong font-medium',
  on_track: 'text-green',
  unscheduled: 'text-muted-foreground italic',
}

const STATUS_ACTIONS: { status: PlanStatusChoice; label: string }[] = [
  { status: 'in_progress', label: 'Mark in progress' },
  { status: 'done', label: 'Mark complete' },
  { status: 'skipped', label: 'Skip — not applicable' },
  { status: 'blocked', label: 'Block' },
  { status: 'open', label: 'Reset to open' },
]

/**
 * A task the user skipped and a task the closeout sweep archived look identical
 * in the data — both are `archived` with a skip stamp. The reason is the only
 * thing that tells them apart, and saying "skipped" for work the firm never
 * chose to drop reads as a decision nobody made.
 */
function closeoutTitle(reason: string | null): string {
  if (reason === 'matter_closed') return 'Archived automatically when the matter closed'
  if (reason === 'lead_lost') return 'Archived automatically when the lead was marked lost'
  if (reason === 'lead_declined') return 'Archived automatically when the lead was declined'
  return 'Skipped — not applicable'
}

/**
 * The stage-level "not applicable".
 *
 * Shows nothing once a stage is finished — there is no such thing as work that
 * was done and also did not apply. It offers the restore only when everything
 * outstanding in the stage is skipped, so a stage with one hand-skipped task in
 * it still reads as work to do.
 */
function StageSkipButton({
  tasks,
  busy,
  onSkip,
  onRestore,
}: {
  tasks: PlanTask[]
  busy: boolean
  onSkip: () => void
  onRestore: () => void
}) {
  // The closeout sweep's rows are the matter's business, not the stage's, so
  // they neither block the skip nor come back with the restore.
  const skippedHere = tasks.filter(task => isTaskSkipped(task) && !task.closeout_reason)
  const outstanding = tasks.filter(task => task.status !== 'done' && !isTaskSkipped(task))

  if (outstanding.length === 0 && skippedHere.length === 0) return null

  const restoring = outstanding.length === 0
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={restoring ? onRestore : onSkip}
      className="h-7 text-xs text-muted-foreground hover:text-foreground"
      title={
        restoring
          ? `Reopen the ${skippedHere.length} skipped task${skippedHere.length === 1 ? '' : 's'} in this stage`
          : `Skip the ${outstanding.length} task${outstanding.length === 1 ? '' : 's'} still open in this stage. Completed work is left alone.`
      }
    >
      {busy ? 'Saving…' : restoring ? 'Restore stage' : 'Not applicable'}
    </Button>
  )
}

function dayLabel(dateKey: string): string {
  // Date keys are calendar days with no timezone; anchor at midday UTC so the
  // firm-timezone formatter cannot roll them back a day.
  return formatFirmDate(`${dateKey}T12:00:00Z`)
}

/** Six-segment bar across the SLA phases, filled by resolved tasks. */
function PhaseProgressBar({ progress }: { progress: SlaProgress }) {
  const phases = progress.phases.filter(phase => phase.total > 0)
  if (phases.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {phases.map(phase => {
          const share = phase.total > 0 ? phase.resolved / phase.total : 0
          const isCurrent = phase.phase === progress.currentPhase
          return (
            <div key={phase.phase} className="min-w-0 flex-1">
              <div
                className={cn(
                  'h-1.5 overflow-hidden rounded-full bg-muted',
                  isCurrent && 'ring-1 ring-primary/40',
                )}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </div>
              <p
                className={cn(
                  'mt-1 truncate text-micro',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {SLA_PHASE_LABEL[phase.phase]}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DaysRemaining({ progress }: { progress: SlaProgress }) {
  if (progress.daysRemaining === null) return null
  const days = progress.daysRemaining
  const label =
    days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past target`
      : `${days} day${days === 1 ? '' : 's'} remaining`
  return (
    <span className={cn('tabular-nums', days < 0 ? 'text-red-strong' : 'text-muted-foreground')}>
      {label}
      {progress.totalPausedDays > 0 && (
        <span className="text-muted-foreground">
          {' '}
          (+{progress.totalPausedDays}d paused)
        </span>
      )}
    </span>
  )
}

function PlanTaskRow({
  matterId,
  matterName,
  showMatter,
  task,
  busy,
  onStatus,
  onNotes,
  onPause,
}: {
  matterId: string
  matterName: string | null
  showMatter: boolean
  task: PlanTask
  busy: boolean
  onStatus: (status: PlanStatusChoice) => void
  onNotes: (notes: string) => void
  onPause: (paused: boolean) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [draft, setDraft] = useState(task.notes ?? '')
  useEffect(() => setDraft(task.notes ?? ''), [task.notes])

  const skipped = isTaskSkipped(task)
  const resolved = task.status === 'done' || skipped
  const tone = dueTone(task)

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={task.status === 'done'}
          disabled={busy}
          aria-label={`Mark "${task.name}" complete`}
          onCheckedChange={checked => onStatus(checked === true ? 'done' : 'open')}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'text-sm',
                resolved ? 'text-muted-foreground line-through' : 'text-foreground',
              )}
            >
              {task.name}
            </span>
            <Badge variant="secondary" className="capitalize">
              {OWNER_LABEL[task.owner] ?? task.owner}
            </Badge>
            {/* A hand-added or stage-fired task sits on the same board as the
                generated plan now, so the board says which is which. */}
            {task.source !== 'sla' && (
              <Badge variant="outline">{TASK_SOURCE_LABEL[task.source]}</Badge>
            )}
            {task.conditional && <Badge variant="outline">conditional</Badge>}
            {task.pauses_clock && <Badge variant="outline">pauses clock</Badge>}
            {task.skill === 'cornerstone-billing' ? (
              <Badge variant="outline" asChild>
                <Link href={`/admin/billing?matter=${matterId}`}>
                  <ReceiptText className="size-3" aria-hidden />
                  Open billing
                </Link>
              </Badge>
            ) : task.skill ? (
              <Badge variant="outline" className="font-mono text-micro" title="Cowork skill">
                <Sparkles className="size-3" aria-hidden />
                {task.skill}
              </Badge>
            ) : null}
            {task.status === 'blocked' && <Badge variant="destructive">blocked</Badge>}
            {skipped && (
              <Badge variant="secondary" title={closeoutTitle(task.closeout_reason)}>
                {task.closeout_reason ? 'closed out' : 'skipped'}
              </Badge>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {showMatter && (
              <>
                <Link
                  href={`/admin/matters/${matterId}`}
                  className="inline-flex max-w-[16rem] items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                  title={matterName ? `Open ${matterName}` : 'Open the matter'}
                >
                  <Briefcase className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{matterName ?? 'Matter'}</span>
                </Link>
                <span aria-hidden className="text-muted-foreground">·</span>
              </>
            )}
            <span className={TONE_CLASS[tone]}>
              {task.due_date ? `Due ${dayLabel(task.due_date)}` : 'Not scheduled yet'}
            </span>
            {task.nudge_date && !task.nudge_sent_at && task.status !== 'done' && (
              <span className="text-muted-foreground">· nudge {dayLabel(task.nudge_date)}</span>
            )}
            {task.nudge_sent_at && <span className="text-muted-foreground">· nudged</span>}
            {task.paused_at && <span className="text-amber-strong">· clock paused</span>}
            {task.total_paused_days > 0 && (
              <span className="text-muted-foreground">· +{task.total_paused_days}d slip</span>
            )}
            <button
              type="button"
              onClick={() => setNotesOpen(open => !open)}
              className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
              {notesOpen ? (
                <ChevronDown className="size-3" aria-hidden />
              ) : (
                <ChevronRight className="size-3" aria-hidden />
              )}
              {task.notes ? 'Notes' : 'Add note'}
            </button>
          </div>

          {notesOpen && (
            <div className="mt-2 space-y-1.5">
              <Textarea
                value={draft}
                rows={2}
                placeholder="Notes for this task"
                onChange={event => setDraft(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || draft === (task.notes ?? '')}
                  onClick={() => onNotes(draft)}
                >
                  Save note
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotesOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {task.pauses_clock && !resolved && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title={task.paused_at ? 'Resume the clock' : 'Pause the clock on this task'}
              onClick={() => onPause(!task.paused_at)}
            >
              {task.paused_at ? (
                <PlayCircle className="size-4" aria-hidden />
              ) : (
                <PauseCircle className="size-4" aria-hidden />
              )}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy}>
                Status
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              {STATUS_ACTIONS.map(action => (
                <DropdownMenuItem
                  key={action.status}
                  disabled={task.status === action.status}
                  onSelect={() => onStatus(action.status)}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}

/** The dates the plan's schedule hangs off. */
export interface SlaAnchors {
  discoveryCallAt: string | null
  pmpsAt: string | null
  recommendationsSentAt: string | null
  engagementSignedAt: string | null
  fitDecision: string | null
}

const ANCHOR_FIELDS: { key: keyof SlaAnchors; label: string; hint: string }[] = [
  { key: 'discoveryCallAt', label: 'Discovery call', hint: 'Starts the soft clock' },
  { key: 'pmpsAt', label: 'Planning session', hint: 'Dates the organizer and prep tasks' },
  { key: 'recommendationsSentAt', label: 'Recommendations sent', hint: 'Drives the follow-up nudges' },
  { key: 'engagementSignedAt', label: 'Engagement signed', hint: 'Day 0 — starts the 28-day clock' },
]

/**
 * The dates the plan hangs off. Until one is set the tasks waiting on it have no
 * due date, so this is what turns the checklist into a schedule — which is why
 * it sits above the plan rather than on a settings screen.
 */
function KeyDatesCard({
  anchors,
  saving,
  onSave,
}: {
  anchors: SlaAnchors
  saving: boolean
  onSave: (patch: Partial<SlaAnchors>) => void
}) {
  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-3">
        <CardTitle className="text-sm">Key dates</CardTitle>
        <p className="text-xs text-muted-foreground">
          Setting a date schedules the tasks waiting on it.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
        {ANCHOR_FIELDS.map(field => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs font-medium text-foreground">{field.label}</span>
            <Input
              type="date"
              className="h-9"
              disabled={saving}
              defaultValue={(anchors[field.key] as string | null) ?? ''}
              onChange={event => onSave({ [field.key]: event.target.value || null })}
            />
            <span className="block text-micro text-muted-foreground">{field.hint}</span>
          </label>
        ))}
        <div className="space-y-1">
          <span className="text-xs font-medium text-foreground">Fit decision</span>
          <Select
            value={anchors.fitDecision ?? 'undecided'}
            disabled={saving}
            onValueChange={value =>
              onSave({ fitDecision: value === 'undecided' ? null : value })
            }
          >
            <SelectTrigger className="h-9" aria-label="Fit decision"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="undecided">Not decided</SelectItem>
              <SelectItem value="fit">Proceed — good fit</SelectItem>
              <SelectItem value="not_a_fit">Not a fit</SelectItem>
            </SelectContent>
          </Select>
          <span className="block text-micro text-muted-foreground">
            Gates the organizer and planning-session tasks
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The matter's plan: the same `tasks` rows the queue shows, grouped by pipeline
 * phase with the SLA clock on top, plus the key dates the schedule hangs off.
 *
 * This used to be its own "SLA plan" tab reading its own `matter_tasks` table.
 * It is now a second view of the Tasks tab — one store, two ways of looking at
 * it: the queue answers "what is due", the plan answers "where is this matter".
 */
export function TaskPlanView({
  matterId,
  enabled,
  onTasksChanged,
  showMatter = true,
}: TaskPlanViewProps) {
  const token = useAccessToken()
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [progress, setProgress] = useState<SlaProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyPhase, setBusyPhase] = useState<SlaPhase | 'unphased' | null>(null)
  const [generating, setGenerating] = useState(false)
  const [anchors, setAnchors] = useState<SlaAnchors | null>(null)
  const [matter, setMatter] = useState<PlanMatter | null>(null)
  const [savingAnchors, setSavingAnchors] = useState(false)

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const load = useCallback(async () => {
    if (!authHeaders) return
    setLoading(true)
    try {
      const res = await fetch(`/api/matters/${matterId}/tasks`, { headers: authHeaders })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not load the plan')
      setTasks(body.tasks ?? [])
      setProgress(body.progress ?? null)
      setAnchors(body.anchors ?? null)
      setMatter(body.matter ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the plan')
    } finally {
      setLoading(false)
    }
  }, [authHeaders, matterId])

  useEffect(() => {
    if (enabled && authHeaders) void load()
  }, [enabled, authHeaders, load])

  const saveAnchors = useCallback(
    async (patch: Partial<SlaAnchors>) => {
      if (!authHeaders) return
      setSavingAnchors(true)
      try {
        const res = await fetch(`/api/admin/matters/${matterId}/sla-anchors`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'Could not save the key dates')
        setAnchors(body.anchors ?? null)
        toast.success(
          body.rescheduled > 0
            ? `Saved — ${body.rescheduled} task${body.rescheduled === 1 ? '' : 's'} rescheduled`
            : 'Saved',
        )
        // The dates on every task waiting on that anchor have just changed.
        await load()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save the key dates')
      } finally {
        setSavingAnchors(false)
      }
    },
    [authHeaders, matterId, load],
  )

  /**
   * A whole stage at once. Skipping "Design" on a will-only matter is one
   * decision, and making it ten times over is how a plan stops being kept up.
   */
  const patchPhase = useCallback(
    async (phase: SlaPhase | 'unphased', status: 'skipped' | 'open') => {
      if (!authHeaders) return
      setBusyPhase(phase)
      try {
        const res = await fetch(`/api/matters/${matterId}/tasks/phase`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, status }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'Could not update the stage')
        const label = phase === 'unphased' ? 'No stage' : SLA_PHASE_LABEL[phase]
        const count = `${body.updated} task${body.updated === 1 ? '' : 's'}`
        toast.success(
          status === 'skipped'
            ? `${label} marked not applicable — ${count} skipped`
            : `${label} restored — ${count} reopened`,
        )
        await load()
        onTasksChanged?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update the stage')
      } finally {
        setBusyPhase(null)
      }
    },
    [authHeaders, load, matterId, onTasksChanged],
  )

  const patchTask = useCallback(
    async (taskId: string, payload: Record<string, unknown>) => {
      if (!authHeaders) return
      setBusyId(taskId)
      try {
        const res = await fetch(`/api/matters/${matterId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'Could not update the task')
        if (body?.warning) toast.warning(body.warning)
        else if (body?.shiftedDays > 0) {
          toast.success(`Downstream dates moved out ${body.shiftedDays} day(s)`)
        }
        await load()
        onTasksChanged?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update the task')
      } finally {
        setBusyId(null)
      }
    },
    [authHeaders, load, matterId, onTasksChanged],
  )

  const generate = useCallback(async () => {
    if (!authHeaders) return
    setGenerating(true)
    try {
      const res = await fetch(`/api/matters/${matterId}/tasks/generate`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_name: 'estate_planning_sla' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not generate the plan')
      toast.success(body.created ? 'Plan generated' : 'This matter already has a plan')
      await load()
      onTasksChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the plan')
    } finally {
      setGenerating(false)
    }
  }, [authHeaders, load, matterId, onTasksChanged])

  const byPhase = useMemo(() => {
    const groups = new Map<SlaPhase | 'unphased', PlanTask[]>()
    for (const phase of SLA_PHASES) {
      const inPhase = tasks
        .filter(task => task.phase === phase)
        .sort((a, b) => a.sort_order - b.sort_order)
      if (inPhase.length > 0) groups.set(phase, inPhase)
    }
    // Hand-added work that names no phase still belongs on the board — leaving
    // it out is how the plan and the queue drifted apart in the first place.
    const unphased = tasks
      .filter(task => task.phase === null || !SLA_PHASES.includes(task.phase))
      .sort((a, b) => a.sort_order - b.sort_order)
    if (unphased.length > 0) groups.set('unphased', unphased)
    return groups
  }, [tasks])

  return (
    <div className="space-y-4">
      {loading ? (
        <Card>
          <CardContent className="space-y-2 py-6">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          {anchors && (
            <KeyDatesCard anchors={anchors} saving={savingAnchors} onSave={saveAnchors} />
          )}
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="px-0">
                <EmptyState
                  icon={ListChecks}
                  title="No plan on this matter"
                  description="Generate the standard estate planning checklist — every task dated from today, with client nudges and internal reminders already scheduled. The tasks land in this matter's queue too."
                  action={
                    <Button onClick={() => void generate()} disabled={generating}>
                      <CalendarCheck className="size-4" aria-hidden />
                      {generating ? 'Generating…' : 'Generate plan'}
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {progress && (
                <Card>
                  <CardHeader className="border-b [.border-b]:pb-4">
                    <CardTitle className="text-sm">
                      {progress.currentPhase
                        ? `${SLA_PHASE_LABEL[progress.currentPhase]} phase`
                        : 'Plan'}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {progress.complete} of {progress.total} tasks complete
                      {' · '}
                      <DaysRemaining progress={progress} />
                      {progress.overdue > 0 && (
                        <span className="text-red-strong"> · {progress.overdue} overdue</span>
                      )}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <PhaseProgressBar progress={progress} />
                  </CardContent>
                </Card>
              )}

              {[...byPhase.entries()].map(([phase, phaseTasks]) => (
                <Card key={phase}>
                  <CardHeader className="border-b [.border-b]:pb-3">
                    <CardTitle className="text-sm">
                      {phase === 'unphased' ? 'No stage' : SLA_PHASE_LABEL[phase]}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {phaseTasks.filter(task => task.status === 'done').length} of{' '}
                      {phaseTasks.length} complete
                    </p>
                    <CardAction>
                      <StageSkipButton
                        tasks={phaseTasks}
                        busy={busyPhase === phase}
                        onSkip={() => void patchPhase(phase, 'skipped')}
                        onRestore={() => void patchPhase(phase, 'open')}
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="px-0">
                    <ul className="divide-y divide-border">
                      {phaseTasks.map(task => (
                        <PlanTaskRow
                          key={task.id}
                          matterId={matterId}
                          matterName={matter?.name ?? null}
                          showMatter={showMatter}
                          task={task}
                          busy={busyId === task.id}
                          onStatus={status => void patchTask(task.id, { status })}
                          onNotes={notes => void patchTask(task.id, { notes })}
                          onPause={paused => void patchTask(task.id, { paused })}
                        />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
