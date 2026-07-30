import { FIRM_TIMEZONE, firmDateKey } from '@/lib/firmDate'
import type { AttentionItem } from '@/app/admin/calendar/types'

export interface CalendarWorkEvent {
  startIso: string
  endIso: string
  kind: 'client' | 'internal'
}

export interface WorkloadDay {
  date: string
  clientMinutes: number
  internalMinutes: number
  targetMinutes: number
  isToday: boolean
}

export interface SlotAnnotationInput {
  slots: string[]
  durationMinutes: number
  timezone: string
  weeklyHours: Record<string, Array<{ start: string; end: string }>>
  existingClientStarts: string[]
  clientMeetingCap: number
}

function localParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: value('weekday').slice(0, 3).toLowerCase(),
    minutes: Number(value('hour')) % 24 * 60 + Number(value('minute')),
  }
}

function insideWorkingHours(
  iso: string,
  durationMinutes: number,
  timezone: string,
  weeklyHours: SlotAnnotationInput['weeklyHours'],
): boolean {
  const local = localParts(iso, timezone)
  return (weeklyHours[local.weekday] ?? []).some(window => {
    const [startHour, startMinute] = window.start.split(':').map(Number)
    const [endHour, endMinute] = window.end.split(':').map(Number)
    const start = startHour * 60 + startMinute
    const end = endHour * 60 + endMinute
    return local.minutes >= start && local.minutes + durationMinutes <= end
  })
}

export function annotateSlots(input: SlotAnnotationInput) {
  const counts = new Map<string, number>()
  for (const start of input.existingClientStarts) {
    const key = localParts(start, input.timezone).date
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return input.slots.map(startIso => {
    const date = localParts(startIso, input.timezone).date
    const ordinal = (counts.get(date) ?? 0) + 1
    return {
      startIso,
      endIso: new Date(Date.parse(startIso) + input.durationMinutes * 60_000).toISOString(),
      afterHours: !insideWorkingHours(
        startIso,
        input.durationMinutes,
        input.timezone,
        input.weeklyHours,
      ),
      meetingOrdinal: ordinal,
      overCap: ordinal > input.clientMeetingCap,
    }
  })
}

export function aggregateWorkload(
  dates: string[],
  events: CalendarWorkEvent[],
  targetMinutes: number,
  todayKey: string,
): WorkloadDay[] {
  const totals = new Map(dates.map(date => [date, { client: 0, internal: 0 }]))
  for (const event of events) {
    const date = firmDateKey(event.startIso)
    const bucket = date ? totals.get(date) : null
    if (!bucket) continue
    const minutes = Math.max(0, Math.round((Date.parse(event.endIso) - Date.parse(event.startIso)) / 60_000))
    bucket[event.kind] += minutes
  }
  return dates.map(date => {
    const total = totals.get(date) ?? { client: 0, internal: 0 }
    return {
      date,
      clientMinutes: total.client,
      internalMinutes: total.internal,
      targetMinutes,
      isToday: date === todayKey,
    }
  })
}

export function nextWorkingDateKeys(from: Date, count: number, timezone = FIRM_TIMEZONE): string[] {
  const keys: string[] = []
  const cursor = new Date(from)
  while (keys.length < count) {
    const key = cursor.toLocaleDateString('en-CA', { timeZone: timezone })
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) keys.push(key)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

export interface AppointmentAttentionSignals {
  appointmentId: string
  attendeeName: string
  typeLabel: string
  matterId: string
  startsInHours: number
  intakeFlagCount: number
  designUnapproved: boolean
  designBlockingCount: number
  signingTaskCount: number
  followUpOwed: boolean
  nextAction?: { label: string; href: string } | null
}

/** Pure attention derivation; the server loader is responsible only for facts. */
export function deriveAppointmentAttention(signals: AppointmentAttentionSignals): AttentionItem[] {
  const items: AttentionItem[] = []
  if (signals.startsInHours >= 0 && signals.startsInHours <= 24 && signals.intakeFlagCount > 0) {
    items.push({
      id: `${signals.appointmentId}:intake`,
      severity: signals.startsInHours <= 4 ? 'red' : 'amber',
      title: `${signals.attendeeName}: intake needs review`,
      detail: `${signals.intakeFlagCount} intake item${signals.intakeFlagCount === 1 ? '' : 's'} remain before ${signals.typeLabel}.`,
      matterId: signals.matterId,
      actions: [
        { label: 'Review intake', href: `/admin/matters/${signals.matterId}?tab=intake` },
        { label: 'Open matter', href: `/admin/matters/${signals.matterId}` },
      ],
    })
  }
  if (signals.designUnapproved) {
    items.push({
      id: `${signals.appointmentId}:design`,
      severity: /signing/i.test(signals.typeLabel) ? 'red' : 'amber',
      title: `${signals.attendeeName}: design sheet not approved`,
      detail: signals.designBlockingCount
        ? `${signals.designBlockingCount} blocking design decision${signals.designBlockingCount === 1 ? '' : 's'} remain.`
        : 'The design sheet still needs attorney approval.',
      matterId: signals.matterId,
      actions: [
        { label: 'Open design sheet', href: `/admin/drafting/${signals.matterId}` },
        { label: 'Open matter', href: `/admin/matters/${signals.matterId}` },
      ],
    })
  }
  if (/signing/i.test(signals.typeLabel) && signals.signingTaskCount > 0) {
    items.push({
      id: `${signals.appointmentId}:signing`,
      severity: 'red',
      title: `${signals.attendeeName}: signing prep is open`,
      detail: `${signals.signingTaskCount} pre-signing task${signals.signingTaskCount === 1 ? '' : 's'} need attention.`,
      matterId: signals.matterId,
      actions: [
        { label: 'Review tasks', href: `/admin/matters/${signals.matterId}?tab=tasks` },
        { label: 'Open matter', href: `/admin/matters/${signals.matterId}` },
      ],
    })
  }
  if (signals.followUpOwed) {
    items.push({
      id: `${signals.appointmentId}:followup`,
      severity: 'amber',
      title: `${signals.attendeeName}: follow-up not logged`,
      detail: `No note or next-step activity appears after this ${signals.typeLabel}.`,
      matterId: signals.matterId,
      actions: [
        { label: 'Log notes', href: `/admin/matters/${signals.matterId}?tab=notes` },
        ...(signals.nextAction ? [signals.nextAction] : []),
      ],
    })
  }
  return items
}
