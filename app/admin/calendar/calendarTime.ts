import { dateInstant, nextDateKey } from '@/lib/calendarAvailability'
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
