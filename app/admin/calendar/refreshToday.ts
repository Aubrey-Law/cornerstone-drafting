'use server'
import { revalidateTag } from 'next/cache'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { TODAY_CALENDAR_TAG } from '@/lib/appointments/calendarSnapshot'
export async function refreshTodayCalendar() {
  await requireAdminServerAction()
  revalidateTag(TODAY_CALENDAR_TAG, { expire: 0 })
}
