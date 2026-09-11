'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { compareTasks, isTaskOpen, formatTaskDate, type TaskRow } from '@/lib/tasks/types'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

export function leadDisplayDate(value: string | null | undefined, timeZone: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: dateOnly ? 'UTC' : timeZone, month: 'short', day: 'numeric', year: 'numeric',
    ...(!dateOnly ? { hour: 'numeric' as const, minute: '2-digit' as const } : {}),
  }).format(new Date(value))
}

/** Date-only milestones stay upcoming for their entire firm-local day. */
export function leadNextMeetingDate(value: string | null | undefined, timeZone: string): string {
  const empty = 'No meeting scheduled'
  if (!value || !Number.isFinite(Date.parse(value))) return empty
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const past = dateOnly
    ? value < new Date().toLocaleDateString('en-CA', { timeZone })
    : Date.parse(value) < Date.now()
  return past ? empty : leadDisplayDate(value, timeZone)
}

export function leadProgressLabel(lead: LeadDetailRecord, agreementStatus?: string | null): string {
  if (lead.lead_status !== 'lead') return lead.lead_status === 'hired' ? 'Hired' : 'Closed'
  const status = agreementStatus ?? lead.engagement_status
  if (status === 'completed' || status === 'signed' || lead.engagement_signed_at) return 'Agreement signed'
  if (['sent', 'sending', 'viewed', 'partially_signed'].includes(String(status))) return 'Awaiting signature'
  if (status === 'draft' || status === 'ready' || status === 'failed') return 'Preparing engagement'
  if (lead.intake_completed_at || ['submitted', 'approved'].includes(String(lead.status))) return 'Intake received'
  return lead.intake_sent_at ? 'Awaiting intake' : 'New inquiry'
}

export function LeadOverview({ lead, nextAppointmentAt, lastContactAt, lastResponseAt, updatedAt,
  agreementStatus, timeZone, taskCount, tasksVersion, onIntake, onEngagement, onTasks, onSchedule,
}: {
  lead: LeadDetailRecord
  nextAppointmentAt: string | null
  lastContactAt: string | null
  lastResponseAt: string | null
  updatedAt: string | null
  agreementStatus?: string | null
  timeZone: string
  taskCount: number
  tasksVersion: number
  onIntake: () => void
  onEngagement: () => void
  onTasks: () => void
  onSchedule: () => void
}) {
  const token = useAccessToken()
  const [nextTask, setNextTask] = useState<TaskRow | null>(null)
  const [taskError, setTaskError] = useState(false)
  const [taskLoading, setTaskLoading] = useState(taskCount > 0)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!token || taskCount === 0) { setNextTask(null); setTaskError(false); setTaskLoading(false); return }
    let cancelled = false
    setTaskLoading(true)
    setTaskError(false)
    void fetch(`/api/admin/tasks?status=open&recordId=${encodeURIComponent(lead.id)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('Could not load tasks')
      const result = await response.json()
      if (!Array.isArray(result.tasks)) throw new Error('Could not load tasks')
      if (!cancelled) setNextTask((result.tasks as TaskRow[]).filter(isTaskOpen).sort(compareTasks)[0] ?? null)
    }).catch(() => { if (!cancelled) setTaskError(true) })
      .finally(() => { if (!cancelled) setTaskLoading(false) })
    return () => { cancelled = true }
  }, [lead.id, token, taskCount, tasksVersion, retry])
  const segments = getLeadIntakeProgress(lead)
  const completed = segments.filter(segment => segment.complete).length
  return (
    <section aria-label="Lead overview" className="space-y-4">
      <div className="grid gap-3 @[640px]:grid-cols-2 @[1100px]:grid-cols-4">
        <OverviewFact label="Next meeting" value={leadNextMeetingDate(nextAppointmentAt, timeZone)}>
          <Button variant="link" className="h-auto p-0" onClick={onSchedule}>Schedule meeting</Button>
        </OverviewFact>
        <OverviewFact label="Intake" value={`${completed} of ${segments.length} sections complete`}>
          <Button variant="link" className="h-auto p-0" onClick={onIntake}>Review intake</Button>
        </OverviewFact>
        <OverviewFact label="Engagement" value={agreementStatus ? (agreementStatus.charAt(0).toUpperCase() + agreementStatus.slice(1)).replaceAll('_', ' ') : 'Not prepared'}>
          <Button variant="link" className="h-auto p-0" onClick={onEngagement}>View engagement details</Button>
        </OverviewFact>
        <OverviewFact label="Next task" value={taskLoading ? 'Loading…' : taskError ? 'Task status unavailable' : nextTask?.title ?? (taskCount > 0 ? 'Open the task queue' : 'No open tasks')}>
          {nextTask && !taskError && <p className="text-xs text-muted-foreground">{nextTask.assignee_name || 'Unassigned'} · {formatTaskDate(nextTask.due_at ?? nextTask.soft_due_at)}</p>}
          {taskError && <button className="text-sm underline" onClick={() => setRetry(value => value + 1)}>Couldn’t load tasks. Retry</button>}
          <Button variant="link" className="h-auto p-0" onClick={onTasks}>View tasks ({taskCount})</Button>
        </OverviewFact>
      </div>
      <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm @[640px]:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Last client contact</dt><dd className="mt-1">{leadDisplayDate(lastContactAt, timeZone)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Last client response</dt><dd className="mt-1">{leadDisplayDate(lastResponseAt, timeZone)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Record updated</dt><dd className="mt-1">{leadDisplayDate(updatedAt, timeZone)}</dd></div>
      </dl>
    </section>
  )
}

function OverviewFact({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-border bg-card p-4"><h2 className="text-xs font-medium text-muted-foreground">{label}</h2><p className="my-2 break-words text-sm font-semibold">{value}</p><div className="space-y-1">{children}</div></div>
}
