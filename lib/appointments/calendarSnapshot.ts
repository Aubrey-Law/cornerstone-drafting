import 'server-only'
import { unstable_cache } from 'next/cache'
import { listCalendarView } from '@/lib/appointments/graphEvents'
import { getMicrosoftConnectionForUser } from '@/lib/microsoftCalendar'

export const TODAY_CALENDAR_TAG = 'today-calendar-snapshot'
const readSnapshot = unstable_cache(async (ownerId: string, day: string, from: string, to: string) => {
  const result = await listCalendarView(from, to, ownerId)
  return { result, fetchedAt: new Date().toISOString(), day }
}, ['today-calendar-v1'], { revalidate: 300, tags: [TODAY_CALENDAR_TAG] })

/** Display cache only. Availability/booking checks continue to use fresh Graph reads. */
export async function fetchCalendarSnapshot(day: string, from: string, to: string) {
  const owner = await getMicrosoftConnectionForUser(null)
  if (!owner) throw new Error('Outlook is not connected')
  // Resolve the configured owner before using the cache; disconnected or changed
  // accounts never inherit a previous mailbox's cached events.
  const snapshot = await readSnapshot(owner.user_id, day, from, to)
  return { ...snapshot, stale: Date.now() - Date.parse(snapshot.fetchedAt) > 300_000 }
}
