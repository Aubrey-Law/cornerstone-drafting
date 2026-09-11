import type { Metadata } from 'next'
import { CalendarClient } from './CalendarClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Calendar' }

export default async function AdminCalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[] }>
}) {
  const { date } = await searchParams
  return <CalendarClient initialDay={typeof date === 'string' ? date : null} />
}
