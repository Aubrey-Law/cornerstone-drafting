'use client'

import Link from 'next/link'
import { CalendarPlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlanData } from './types'

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`.trim() || '0m'
}

export function PlanView({
  data,
  onBook,
  onAskAssistant,
}: {
  data: PlanData | null
  onBook: (deadline: PlanData['deadlines'][number]) => void
  onAskAssistant: (prompt: string) => void
}) {
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
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Workload · next 10 working days</h2>
            <p className="text-xs text-muted-foreground">Client time, drafting and internal work against the firm target.</p>
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
                <div className="mt-1 truncate text-[10px] text-muted-foreground">
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
                  <Link href={`/admin/leads/${item.leadId}`} className="text-xs font-semibold text-foreground hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-xs font-semibold text-foreground">{item.label}</span>
                )}
                <p className="text-[11px] text-muted-foreground">{new Date(item.date).toLocaleDateString()}</p>
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
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{task.estimateMinutes}m</span>
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
  return <div className="rounded-md bg-muted p-3"><div className="text-lg font-semibold text-foreground">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>
}
