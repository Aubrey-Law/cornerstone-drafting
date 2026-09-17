import type { CalendarRef } from './calendarTypes'

/**
 * Which calendars display, and which protect the firm's time.
 *
 * Only deviations from the default are stored, so "absent from both arrays"
 * is the meaningful state a new calendar arrives in: visible, non-blocking.
 * Blocking is opted into per calendar because Google's freeBusy treats an
 * all-day event as busy for the whole day — a subscribed holiday or birthday
 * calendar that blocked by default would silently make the attorney
 * unbookable on every one of those days.
 *
 * Pure by design: no Google, no Supabase, so each rule is testable on its own.
 */

/** Normalize an id list off the wire or out of the database. */
export function sanitizeCalendarIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/**
 * The calendars to read events from.
 *
 * The primary calendar survives whatever `hiddenIds` says. It is what
 * "connected" means — `listCalendarView` reads it first and a failure there is
 * fatal — so the rule is enforced here rather than trusted to the UI.
 */
export function visibleCalendars(
  all: readonly CalendarRef[],
  hiddenIds: readonly string[],
): CalendarRef[] {
  const hidden = new Set(hiddenIds)
  return all.filter(calendar => calendar.isDefault || !hidden.has(calendar.id))
}

/**
 * The `freeBusy` request's calendar ids: primary, then each blocking calendar.
 *
 * `primary` is an alias rather than an id, so a blocking entry naming the
 * primary calendar by its real address would ask about the same calendar
 * twice. That is harmless — availability takes the union of busy intervals —
 * and the literal duplicate is collapsed here anyway.
 */
export function busyCalendarIds(blockingIds: readonly string[]): string[] {
  return [...new Set(['primary', ...blockingIds])]
}

/**
 * Blocking ids that no longer match a calendar on the account.
 *
 * A stale id errors on every `freeBusy` call, and under the fail-closed rule
 * that takes availability down. The settings UI renders these as removable so
 * the surface that creates them is the surface that clears them.
 */
export function staleBlockingIds(
  all: readonly CalendarRef[],
  blockingIds: readonly string[],
): string[] {
  const live = new Set(all.map(calendar => calendar.id))
  return blockingIds.filter(id => !live.has(id))
}
