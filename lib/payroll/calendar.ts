import 'server-only'

import { createCalendarHold } from '@/lib/appointments/googleEvents'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { listFilings, setFilingCalendarEvent } from './server'

/**
 * Payroll deadlines as reminders on the firm's Google Calendar (the calendar
 * the app's own Calendar page reads). Each open deadline gets one 9:00 hold on
 * its due date that does not block the time. The hold id is derived from the
 * year and deadline key, so syncing again never makes a second event.
 */

/** 09:00 wall-clock in the firm's zone on `isoDate`, as a UTC instant. */
export function firmMorningUtc(isoDate: string, hour = 9, timeZone = FIRM_TIMEZONE): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hour)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map(part => [part.type, part.value]))
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return new Date(guess - (asZone - guess))
}

export interface CalendarSyncResult {
  created: number
  skipped: number
  failed: { key: string; error: string }[]
}

export async function syncPayrollCalendar(taxYear: number, today: string): Promise<CalendarSyncResult> {
  const filings = await listFilings(taxYear)
  const result: CalendarSyncResult = { created: 0, skipped: 0, failed: [] }
  for (const filing of filings) {
    if (filing.doneOn || filing.calendarEventId || filing.dueDate < today) {
      result.skipped++
      continue
    }
    const start = firmMorningUtc(filing.dueDate)
    try {
      const event = await createCalendarHold({
        title: `Payroll · ${filing.title} due`,
        startIso: start.toISOString(),
        endIso: new Date(start.getTime() + 30 * 60_000).toISOString(),
        showAsBusy: false,
        idempotencyKey: `payroll:${taxYear}:${filing.key}`,
      })
      await setFilingCalendarEvent(taxYear, filing.key, event.eventId)
      result.created++
    } catch (error) {
      result.failed.push({ key: filing.key, error: error instanceof Error ? error.message : 'Calendar error' })
    }
  }
  return result
}
