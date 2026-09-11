import 'server-only'
import { unstable_cache } from 'next/cache'
import { listCalendarView } from '@/lib/appointments/googleEvents'
import { getGoogleConnectionForUser } from '@/lib/googleCalendar'

export const TODAY_CALENDAR_TAG = 'today-calendar-snapshot'
const readSnapshot = unstable_cache(async (ownerId: string, day: string, from: string, to: string) => {
  const result = await listCalendarView(from, to, ownerId)
  return { result, fetchedAt: new Date().toISOString(), day }
}, ['today-calendar-v1'], { revalidate: 300, tags: [TODAY_CALENDAR_TAG] })

/** Display cache only. Availability/booking checks still use fresh calendar reads. */
export async function fetchCalendarSnapshot(day: string, from: string, to: string) {
  const owner = await getGoogleConnectionForUser(null)
  if (!owner) throw new Error('Google Calendar is not connected')
  // Resolve the configured owner before using the cache; disconnected or changed
  // accounts never inherit a previous account's cached events.
  const snapshot = await readSnapshot(owner.user_id, day, from, to)
  return { ...snapshot, stale: Date.now() - Date.parse(snapshot.fetchedAt) > 300_000 }
}
