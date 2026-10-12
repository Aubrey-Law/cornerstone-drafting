'use client'

import Link from 'next/link'
import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { PlanData } from './types'

const BAND_LABEL = ['Critical', 'Today', 'Soon', 'Planned', 'Waiting'] as const

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`.trim() || '0m'
}

export function PlanView({
  data,
  error = false,
  onBook,
  onAskAssistant,
}: {
  data: PlanData | null
  error?: boolean
  onBook: (deadline: PlanData['deadlines'][number]) => void
  onAskAssistant: (prompt: string) => void
}) {
  if (error) {
    return <div role="alert" className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">Could not load the plan.</div>
  }
  if (!data) {
    return <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">Loading plan…</div>
  }
  const worst = [...data.days].sort((a, b) =>
    (b.clientMinutes + b.internalMinutes - b.targetMinutes)
    - (a.clientMinutes + a.internalMinutes - a.targetMinutes),
  )[0]
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Today&apos;s working plan</h2>
              <Badge variant={data.today.status === 'committed' ? 'default' : 'secondary'}>
                {data.today.status === 'uncommitted' ? 'Preview' : data.today.status}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {minutesLabel(data.today.plannedMinutes)} planned of {minutesLabel(data.today.capacityMinutes)} available.
              {' '}This is the same priority order used by Today.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin">Open Today plan</Link>
          </Button>
        </div>

        {data.today.overload && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Critical work exceeds available capacity by {minutesLabel(data.today.overloadMinutes)}. Defer, delegate, or reschedule a specific item in Today.
          </div>
        )}

        {data.today.items.length ? (
          <ol className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
            {data.today.items.map(item => (
              <li key={item.workKey} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={item.priorityBand === 0 ? 'destructive' : 'secondary'} className="text-micro">
                      {BAND_LABEL[item.priorityBand]}
                    </Badge>
                    {item.itemStatus === 'completed' && (
                      <span className="inline-flex items-center gap-1 text-micro text-green">
                        <CheckCircle2 className="size-3" aria-hidden /> Done
                      </span>
                    )}
                    <Link href={item.href} className="truncate text-xs font-semibold text-foreground hover:underline">
                      {item.title}
                    </Link>
                  </div>
                  <p className="mt-1 truncate text-micro text-muted-foreground">
                    {item.recordName} · {item.priorityReasons.join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  {item.blockStart ? (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <CalendarClock className="size-3.5" aria-hidden />
                      {new Date(item.blockStart).toLocaleTimeString('en-US', {
                        hour: 'numeric', minute: '2-digit', timeZone: FIRM_TIMEZONE,
                      })}
                    </span>
                  ) : (
                    <span>Not scheduled</span>
                  )}
                  <div className="text-micro">{minutesLabel(item.estimateMinutes)}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">No executable work is planned for today.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Workload · next 10 working days</h2>
            <p className="text-xs text-muted-foreground">
              {data.googleStatus === 'unavailable'
                ? 'Cornerstone appointments only. Google Calendar is not included.'
                : data.googleStatus === 'partial'
                  ? 'Hidden because Google Calendar returned a partial result.'
                  : 'Client time, drafting and internal work against the firm target.'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onAskAssistant('Plan my week')}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Plan with assistant
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-10 items-end gap-2">
          {data.days.map(day => {
            const total = day.clientMinutes + day.internalMinutes
            const scale = Math.max(day.targetMinutes, total, 1)
            const clientHeight = day.clientMinutes / scale * 112
            const internalHeight = day.internalMinutes / scale * 112
            const over = Math.max(0, total - day.targetMinutes) / scale * 112
            return (
              <div key={day.date} className="min-w-0 text-center">
                <div className={`relative mx-auto flex h-28 w-full max-w-10 flex-col-reverse overflow-hidden rounded-sm border ${day.isToday ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
                  <div style={{ height: clientHeight, background: 'var(--primary)' }} title={`${minutesLabel(day.clientMinutes)} client`} />
                  <div style={{ height: internalHeight, background: 'var(--stage-active)' }} title={`${minutesLabel(day.internalMinutes)} internal`} />
                  {over > 0 && <div className="absolute inset-x-0 top-0" style={{ height: over, background: 'var(--red-strong)' }} />}
                </div>
                <div className="mt-1 truncate text-micro text-muted-foreground">
                  {new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                </div>
              </div>
            )
          })}
        </div>
        {worst && (
          <p className="mt-3 text-xs text-muted-foreground">
            {new Date(`${worst.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })} is the tightest day at{' '}
            {minutesLabel(worst.clientMinutes + worst.internalMinutes)}.{' '}
            <button className="font-medium text-primary hover:underline" onClick={() => onAskAssistant(`Help rebalance ${worst.date}`)}>
              Ask the assistant to rebalance it.
            </button>
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanSection title="Dates & deadlines">
          {data.deadlines.length ? data.deadlines.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
              <div>
                {item.matterId ? (
                  <Link href={`/admin/matters/${item.matterId}`} className="text-xs font-semibold text-foreground hover:underline">
                    {item.label}
                  </Link>
                ) : item.leadId ? (
                  <Link href={`/admin/crm/opportunities/${item.leadId}`} className="text-xs font-semibold text-foreground hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-xs font-semibold text-foreground">{item.label}</span>
                )}
                <p className="text-micro text-muted-foreground">{new Date(item.date).toLocaleDateString()}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onBook(item)}>
                <CalendarPlus className="mr-1 h-3 w-3" /> Block {item.durationMinutes}m
              </Button>
            </div>
          )) : <Empty>No upcoming non-meeting deadlines</Empty>}
        </PlanSection>
        <PlanSection title="Unscheduled work">
          {data.unscheduledTasks.length ? data.unscheduledTasks.map(task => (
            <div key={task.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
              <span className="text-xs text-foreground">{task.title}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">{task.estimateMinutes}m</span>
            </div>
          )) : <Empty>No estimated work waiting to schedule</Empty>}
        </PlanSection>
      </div>

      <PlanSection title="Last week in review">
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
          <Stat label="Meetings held" value={data.review.meetingsHeld} />
          <Stat label="No-shows" value={data.review.noShows} />
          <Stat label="Matters advanced" value={data.review.mattersAdvanced} />
          <Stat label="Notes not logged" value={data.review.notesMissing} />
        </div>
        {data.review.slipped.length > 0 && (
          <div className="border-t border-border px-3 py-2">
            <h3 className="text-xs font-semibold text-foreground">What slipped</h3>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
              {data.review.slipped.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
      </PlanSection>
    </div>
  )
}

function PlanSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-border bg-card"><h2 className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">{title}</h2>{children}</section>
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-xs text-muted-foreground">{children}</p>
}
function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-muted p-3"><div className="text-lg font-semibold text-foreground">{value}</div><div className="text-micro text-muted-foreground">{label}</div></div>
}
