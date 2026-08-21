import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Calendly appointment calendar mirror', () => {
  it('adds an idempotent Calendly appointment source without hiding real conflicts', () => {
    const migration = read(
      'supabase/migrations/20260821171449_calendly_appointment_calendar_sync.sql',
    )

    expect(migration).toMatch(/add column if not exists external_booking_uid text/i)
    expect(migration).toMatch(/check \(source in \('public', 'portal', 'admin', 'calendly'\)\)/i)
    expect(migration).toMatch(/unique \(source, external_booking_uid\)/i)
    expect(migration).toMatch(
      /appointments_no_overlap[\s\S]*status = 'scheduled'[\s\S]*source in \('public', 'portal', 'admin'\)/i,
    )
  })

  it('upserts the provider booking into the native appointments table', () => {
    const sync = read('lib/bookings/sync.ts')

    expect(sync).toMatch(/from\('appointments'\)\.upsert\(\{/)
    expect(sync).toMatch(/source: 'calendly'/)
    expect(sync).toMatch(/external_booking_uid: bookingUid/)
    expect(sync).toMatch(/onConflict: 'source,external_booking_uid'/)
  })

  it('keeps provider-managed appointments read-only in both API and UI', () => {
    const route = read('app/api/admin/scheduling/appointments/route.ts')
    const drawer = read('app/admin/calendar/EventPrepDrawer.tsx')
    const calendar = read('app/admin/calendar/CalendarClient.tsx')

    expect(route).toMatch(/appointment\.source === 'calendly'/)
    expect(route).toContain('This appointment is managed in Calendly')
    expect(drawer).toContain('Managed in Calendly')
    expect(calendar).toMatch(/a\.status === 'scheduled' && a\.source !== 'calendly'/)
  })
})
