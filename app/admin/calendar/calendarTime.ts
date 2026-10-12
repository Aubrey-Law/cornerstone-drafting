import { calendarAnchorDate } from '@/lib/calendarDay'
import { dateInstant, nextDateKey } from '@/lib/calendarAvailability'
import { nextWorkingDateKeys } from '@/lib/calendarProductivity'

/** Week and plan ranges. Same-month ends stay "October 11 – 17, 2026". */
export function formatSpanHeading(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  })
  if (sameMonth) return `${startLabel} – ${end.getDate()}, ${end.getFullYear()}`
  return `${startLabel} – ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
}

/** Ten working days starting from a firm calendar date, labeled in that calendar. */
export function formatPlanHeading(dateKey: string, timezone: string): string {
  const keys = nextWorkingDateKeys(new Date(`${dateKey}T12:00:00Z`), 10, timezone)
  const start = calendarAnchorDate(keys[0], new Date())
  const end = calendarAnchorDate(keys[keys.length - 1], start)
  return formatSpanHeading(start, end)
}

/** HH:mm in the scheduling timezone, for date/time inputs. */
export function zonedTimeInput(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const hour = parts.find(part => part.type === 'hour')?.value ?? '00'
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00'
  return `${hour === '24' ? '00' : hour}:${minute}`
}

export type WeekWorkloadStatus = 'included' | 'unavailable' | 'partial' | 'failed'

/** A missing or failed response is not the same as a disconnected Google account. */
export function weekWorkloadFromBody(body: { googleStatus?: string; connected?: boolean; days?: unknown[] } | null): {
  status: WeekWorkloadStatus
  days: unknown[]
} {
  if (!body) return { status: 'failed', days: [] }
  const status: WeekWorkloadStatus = body.googleStatus === 'included' || body.googleStatus === 'unavailable' || body.googleStatus === 'partial'
    ? body.googleStatus
    : body.connected ? 'included' : 'partial'
  return { status, days: status === 'partial' ? [] : body.days ?? [] }
}

/** Category fill is for scheduled meetings. No-show, cancelled, and rescheduled stay muted. */
export function monthChipStyle(status: string, category: { bg: string; text: string; dot: string }): { background: string; color: string; borderLeft: string } | undefined {
  if (status !== 'scheduled') return undefined
  return { background: category.bg, color: category.text, borderLeft: `3px solid ${category.dot}` }
}

export function instantDayKey(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone })
}
export function instantMinutes(iso: string, timezone?: string): number {
  if (!timezone) { const date = new Date(iso); return date.getHours() * 60 + date.getMinutes() }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  return Number(parts.find(part => part.type === 'hour')?.value) * 60 + Number(parts.find(part => part.type === 'minute')?.value)
}
export function columnInterval(date: string, start: string, end: string, timezone?: string) {
  const midnight = timezone ? dateInstant(date, timezone) : new Date(`${date}T00:00:00`).getTime()
  const next = timezone ? dateInstant(nextDateKey(date), timezone) : new Date(`${nextDateKey(date)}T00:00:00`).getTime()
  return { start: Date.parse(start) <= midnight ? 0 : instantMinutes(start, timezone), end: Date.parse(end) >= next ? 1440 : instantMinutes(end, timezone) }
}
