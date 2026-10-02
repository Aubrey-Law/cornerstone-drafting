import 'server-only'
import type { BookingWidgetType } from '@/components/scheduling/BookingWidget'
import { listAppointmentTypes } from './settings'

/** Active appointment types shaped for the portal booking client. */
export async function getAppointmentTypesForPortal(): Promise<BookingWidgetType[]> {
  const types = await listAppointmentTypes()
  return types
    .filter(t => t.active)
    .map(t => ({
      key: t.key,
      slug: t.slug,
      label: t.label,
      description: t.description,
      durationMinutes: t.durationMinutes,
      locationType: t.locationType,
      locationTypes: t.locationTypes,
      bookingQuestions: t.bookingQuestions,
    }))
}
