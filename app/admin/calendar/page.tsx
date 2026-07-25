import type { Metadata } from 'next'
import { CalendarClient } from './CalendarClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Calendar' }

export default function AdminCalendarPage() {
  return <CalendarClient />
}
