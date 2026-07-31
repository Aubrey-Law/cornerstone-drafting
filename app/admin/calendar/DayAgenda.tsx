'use client'

import Link from 'next/link'
import {
  CalendarDays,
  Check,
  Circle,
  Clock3,
  FileText,
  Video,
  RotateCcw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  AttentionItem,
  CalendarAppointment,
  CalendarRailData,
  OutlookEvent,
} from './types'
import {
  BLOCK_HATCH,
  CATEGORY_LABEL,
  categorize,
  categoryStyleFor,
  isBlock,
} from './eventCategories'

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ') || '0m'
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function durationMinutes(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000))
}

function nextMeetingLabel(appointments: CalendarAppointment[]) {
  const next = appointments.find(item => item.status === 'scheduled' && Date.parse(item.startTime) > Date.now())
  if (!next) return 'no more meetings'
  const minutes = Math.max(0, Math.round((Date.parse(next.startTime) - Date.now()) / 60_000))
  return `next in ${minutes} min`
}

function AttentionBand({
  items,
  onDismiss,
}: {
  items: AttentionItem[]
  onDismiss: (id: string) => void
}) {
  if (items.length === 0) return null
  const red = items.some(item => item.severity === 'red')
  return (
    <section
      className={cn(
        'rounded-lg border p-3',
        red ? 'border-red-strong-border bg-red-bg' : 'border-amber-strong-border bg-amber-bg',
      )}
    >
      <h2 className="text-sm font-semibold text-foreground">Needs you before your next meeting</h2>
      <div className="mt-2 grid gap-2 lg:grid-cols-3">
        {items.slice(0, 6).map(item => (
          <article key={item.id} className="relative rounded-md border border-border bg-card p-3">
            <button
              type="button"
              aria-label={`Dismiss ${item.title}`}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => onDismiss(item.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <h3 className="pr-5 text-sm font-semibold text-foreground">{item.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.actions.slice(0, 2).map(action => action.href ? (
                <Button key={action.label} asChild size="sm" variant="outline">
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ) : null)}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/**
 * Colour key shared with the month grid: the category's `bg`/`text` tokens fill
 * a strip across the top of the card and its `dot` carries the left edge, so a
 * day reads by colour the same way a month cell does.
 */
function CategoryStrip({ label, style }: { label: string; style: { bg: string; text: string; dot: string } }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-t-[3px] px-2 py-1 text-[11px] font-medium leading-4"
      style={{ background: style.bg, color: style.text }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: style.dot }} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** Outlook events carry the same category colour as their month-grid block. */
function OutlookRow({ event }: { event: OutlookEvent }) {
  const category = categorize(event.subject)
  const style = categoryStyleFor(event.subject)
  return (
    <div className="flex gap-3">
      <div className="w-[62px] shrink-0 pt-2 text-right text-xs tabular-nums text-muted-foreground">
        {event.isAllDay ? 'All day' : fmtTime(event.startIso)}
      </div>
      <div
        className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        style={{ borderLeft: `3px solid ${style.dot}` }}
      >
        <CategoryStrip label={CATEGORY_LABEL[category]} style={style} />
        <div className="px-3 py-2 text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{event.subject}</p>
          <p className="text-[11px]">Outlook event</p>
        </div>
      </div>
    </div>
  )
}

function AgendaRow({
  appointment,
  onOpen,
  onReschedule,
}: {
  appointment: CalendarAppointment
  onOpen: () => void
  onReschedule: () => void
}) {
  const past = Date.parse(appointment.endTime) < Date.now()
  const followUpReady = Date.now() >= Date.parse(appointment.endTime) + 10 * 60_000
  const minutes = durationMinutes(appointment.startTime, appointment.endTime)
  const pending = appointment.status === 'scheduled' && !past
  const category = categorize(appointment.typeLabel)
  const categoryStyle = categoryStyleFor(appointment.typeLabel)
  return (
    <div className={cn('flex gap-3', past && 'opacity-55')}>
      <div className="w-[62px] shrink-0 pt-2 text-right">
        <div className="text-xs font-semibold tabular-nums text-foreground">{fmtTime(appointment.startTime)}</div>
        <div className="text-[11px] text-muted-foreground">{minutesLabel(minutes)}</div>
      </div>
      <article
        className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        style={{ borderLeft: `3px solid ${categoryStyle.dot}` }}
      >
        <CategoryStrip label={CATEGORY_LABEL[category]} style={categoryStyle} />
        <div className="px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onOpen}
                className={cn('truncate text-left text-[15px] font-semibold text-foreground hover:underline', past && 'line-through')}
              >
                {appointment.attendeeName}
              </button>
              <p className="text-xs text-muted-foreground">
                {appointment.typeLabel}
                {appointment.locationType ? ` · ${appointment.locationType.replace('_', ' ')}` : ''}
                {!appointment.outlookSynced && appointment.status === 'scheduled' ? ' · ⚠ not on Outlook' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {appointment.linkedMatterNumber && (
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                  {appointment.linkedMatterNumber}
                </span>
              )}
              {appointment.linkedMatterStage && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[11px]"
                  style={{ background: 'var(--stage-active-bg)', color: 'var(--stage-active-text)' }}
                >
                  {appointment.linkedMatterStage.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-[11px]">
            <span className="inline-flex items-center gap-1 text-green-700">
              <Check className="h-3 w-3" /> calendar synced
            </span>
            <span className={cn('inline-flex items-center gap-1', pending ? 'text-muted-foreground' : 'text-green-700')}>
              {pending ? <Circle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              {pending ? 'prep pending' : 'meeting complete'}
            </span>
            {appointment.status === 'no_show' && <span className="text-red-700">● no-show</span>}
            <span className="ml-auto flex flex-wrap gap-1">
              {appointment.linkedMatterId && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/admin/matters/${appointment.linkedMatterId}`}>Open matter</Link>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onOpen}>
                <FileText className="mr-1 h-3 w-3" /> Prep pack
              </Button>
              {!past && (
                <Button size="sm" variant="ghost" onClick={onReschedule}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Reschedule
                </Button>
              )}
              {appointment.onlineMeetingUrl && (
                <Button asChild size="sm">
                  <a href={appointment.onlineMeetingUrl} target="_blank" rel="noreferrer">
                    <Video className="mr-1 h-3 w-3" /> Join
                  </a>
                </Button>
              )}
              {followUpReady && (
                <Button size="sm" variant="outline" onClick={onOpen}>
                  After-meeting actions
                </Button>
              )}
            </span>
          </div>
        </div>
      </article>
    </div>
  )
}

export function DayAgenda({
  date,
  appointments,
  outlookEvents,
  attention,
  rail,
  onDismissAttention,
  onOpenAppointment,
  onReschedule,
  onBookSlot,
}: {
  date: Date
  appointments: CalendarAppointment[]
  outlookEvents: OutlookEvent[]
  attention: AttentionItem[]
  rail: CalendarRailData
  onDismissAttention: (id: string) => void
  onOpenAppointment: (appointment: CalendarAppointment) => void
  onReschedule: (appointment: CalendarAppointment) => void
  onBookSlot: (startIso?: string) => void
}) {
  const active = appointments.filter(item => item.status !== 'cancelled')
  const booked = active.reduce((sum, item) => sum + durationMinutes(item.startTime, item.endTime), 0)
  const workday = 8 * 60
  const heading = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const blocks = outlookEvents.filter(isBlock)
  const outlook = outlookEvents.filter(event => !isBlock(event))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_268px]">
      <div className="min-w-0 space-y-3">
        <header>
          <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active.length + outlook.length} events · {minutesLabel(booked)} booked ·{' '}
            {minutesLabel(Math.max(0, workday - booked))} open · {nextMeetingLabel(active)}
          </p>
        </header>
        <AttentionBand items={attention} onDismiss={onDismissAttention} />
        <div className="space-y-2">
          {blocks.map(event => (
            <div key={event.id} className="flex gap-3">
              <div className="w-[62px] shrink-0 pt-1 text-right text-[11px] text-muted-foreground">
                {event.isAllDay ? 'All day' : fmtTime(event.startIso)}
              </div>
              <div
                className="min-h-6 flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground"
                style={{ backgroundImage: BLOCK_HATCH }}
              >
                {event.subject}
              </div>
            </div>
          ))}
          {[...active.map(item => ({ kind: 'appointment' as const, start: item.startTime, item })),
            ...outlook.map(item => ({ kind: 'outlook' as const, start: item.startIso, item }))]
            .sort((a, b) => a.start.localeCompare(b.start))
            .map(row => row.kind === 'appointment' ? (
              <AgendaRow
                key={row.item.id}
                appointment={row.item}
                onOpen={() => onOpenAppointment(row.item)}
                onReschedule={() => onReschedule(row.item)}
              />
            ) : (
              <OutlookRow key={row.item.id} event={row.item} />
            ))}
          {active.length === 0 && outlook.length === 0 && blocks.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nothing scheduled. Use Quick book or choose an open slot.
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <RailSection icon={CalendarDays} title="Dates this week">
          {rail.datesThisWeek.length ? rail.datesThisWeek.map(item => (
            <Link key={item.id} href={`/admin/matters/${item.matterId}`} className="block rounded px-2 py-1.5 hover:bg-muted">
              <span className="block text-xs font-medium text-foreground">{item.label}</span>
              <span className="text-[11px] text-muted-foreground">{new Date(item.date).toLocaleDateString()}</span>
            </Link>
          )) : <Empty>Nothing due this week</Empty>}
        </RailSection>
        <RailSection icon={Check} title="Follow-ups owed">
          {rail.followUps.length ? rail.followUps.map(item => (
            <Link
              key={item.id}
              href={item.matterId ? `/admin/matters/${item.matterId}?tab=tasks` : `/admin/leads/${item.leadId}`}
              className="block rounded px-2 py-1.5 text-xs text-foreground hover:bg-muted"
            >
              {item.title}
            </Link>
          )) : <Empty>No follow-ups owed</Empty>}
        </RailSection>
        <RailSection icon={Clock3} title="Open time today">
          {rail.openSlots.slice(0, 5).map(slot => (
            <div key={slot.startIso} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-xs text-foreground">{fmtTime(slot.startIso)}</span>
              <Button size="sm" variant="outline" onClick={() => onBookSlot(slot.startIso)}>Book</Button>
            </div>
          ))}
          {rail.openSlots.length === 0 && (
            <Button className="w-full" size="sm" variant="outline" onClick={() => onBookSlot()}>
              Find an open time
            </Button>
          )}
        </RailSection>
      </aside>
    </div>
  )
}

function RailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CalendarDays
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {title}
      </h2>
      <div className="p-1">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-xs text-muted-foreground">{children}</p>
}
