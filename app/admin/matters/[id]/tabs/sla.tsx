'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ListChecks,
  PauseCircle,
  PlayCircle,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatFirmDate } from '@/lib/format'
import { dueTone, type SlaDueTone, type SlaProgress } from '@/lib/slaTasks/schedule'
import {
  SLA_PHASES,
  SLA_PHASE_LABEL,
  type MatterTaskRow,
  type SlaPhase,
  type SlaTaskStatus,
} from '@/lib/slaTasks/types'
import { cn } from '@/lib/utils'

interface MatterSlaTabProps {
  matterId: string
  /** False until the tab is first opened, so its data loads lazily. */
  enabled: boolean
}

const TONE_CLASS: Record<SlaDueTone, string> = {
  done: 'text-muted-foreground',
  overdue: 'text-red-strong font-medium',
  soon: 'text-amber-strong font-medium',
  on_track: 'text-green',
}

const STATUS_ACTIONS: { status: SlaTaskStatus; label: string }[] = [
  { status: 'active', label: 'Mark in progress' },
  { status: 'completed', label: 'Mark complete' },
  { status: 'skipped', label: 'Skip — not applicable' },
  { status: 'blocked', label: 'Block' },
  { status: 'pending', label: 'Reset to pending' },
]

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
                  'mt-1 truncate text-[11px]',
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

function TaskRow({
  task,
  busy,
  onStatus,
  onNotes,
  onPause,
}: {
  task: MatterTaskRow
  busy: boolean
  onStatus: (status: SlaTaskStatus) => void
  onNotes: (notes: string) => void
  onPause: (paused: boolean) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [draft, setDraft] = useState(task.notes ?? '')
  useEffect(() => setDraft(task.notes ?? ''), [task.notes])

  const resolved = task.status === 'completed' || task.status === 'skipped'
  const tone = dueTone(task)

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={task.status === 'completed'}
          disabled={busy}
          aria-label={`Mark "${task.name}" complete`}
          onCheckedChange={checked => onStatus(checked === true ? 'completed' : 'pending')}
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
              {task.assignee}
            </Badge>
            {task.conditional && <Badge variant="outline">conditional</Badge>}
            {task.pauses_clock && <Badge variant="outline">pauses clock</Badge>}
            {task.skill && (
              <Badge variant="outline" className="font-mono text-[10px]" title="Cowork skill">
                <Sparkles className="size-3" aria-hidden />
                {task.skill}
              </Badge>
            )}
            {task.status === 'blocked' && <Badge variant="destructive">blocked</Badge>}
            {task.status === 'skipped' && <Badge variant="secondary">skipped</Badge>}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className={TONE_CLASS[tone]}>Due {dayLabel(task.due_date)}</span>
            {task.nudge_date && !task.nudge_sent_at && task.status !== 'completed' && (
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

/**
 * The matter's SLA plan: the dated checklist generated from a task template,
 * grouped by phase, with the phase progress bar on top.
 */
export function MatterSlaTab({ matterId, enabled }: MatterSlaTabProps) {
  const token = useAccessToken()
  const [tasks, setTasks] = useState<MatterTaskRow[]>([])
  const [progress, setProgress] = useState<SlaProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

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
      if (!res.ok) throw new Error(body?.error ?? 'Could not load the SLA plan')
      setTasks(body.tasks ?? [])
      setProgress(body.progress ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the SLA plan')
    } finally {
      setLoading(false)
    }
  }, [authHeaders, matterId])

  useEffect(() => {
    if (enabled && authHeaders) void load()
  }, [enabled, authHeaders, load])

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
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update the task')
      } finally {
        setBusyId(null)
      }
    },
    [authHeaders, load, matterId],
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
      if (!res.ok) throw new Error(body?.error ?? 'Could not generate the SLA plan')
      toast.success(body.created ? 'SLA plan generated' : 'This matter already has an SLA plan')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the SLA plan')
    } finally {
      setGenerating(false)
    }
  }, [authHeaders, load, matterId])

  const byPhase = useMemo(() => {
    const groups = new Map<SlaPhase, MatterTaskRow[]>()
    for (const phase of SLA_PHASES) {
      const inPhase = tasks
        .filter(task => task.phase === phase)
        .sort((a, b) => a.sort_order - b.sort_order)
      if (inPhase.length > 0) groups.set(phase, inPhase)
    }
    return groups
  }, [tasks])

  return (
    <TabsContent value="sla" className="space-y-4">
      {loading ? (
        <Card>
          <CardContent className="space-y-2 py-6">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="px-0">
            <EmptyState
              icon={ListChecks}
              title="No SLA plan on this matter"
              description="Generate the standard estate planning checklist — every task dated from today, with client nudges and internal reminders already scheduled."
              action={
                <Button onClick={() => void generate()} disabled={generating}>
                  <CalendarCheck className="size-4" aria-hidden />
                  {generating ? 'Generating…' : 'Generate SLA plan'}
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
                    : 'SLA plan'}
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
                <CardTitle className="text-sm">{SLA_PHASE_LABEL[phase]}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {phaseTasks.filter(task => task.status === 'completed').length} of{' '}
                  {phaseTasks.length} complete
                </p>
              </CardHeader>
              <CardContent className="px-0">
                <ul className="divide-y divide-border">
                  {phaseTasks.map(task => (
                    <TaskRow
                      key={task.id}
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
    </TabsContent>
  )
}
