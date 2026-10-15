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
    expect(sync).toMatch(/source: provider,/)
    expect(sync).toMatch(/external_booking_uid: bookingUid/)
    expect(sync).toMatch(/onConflict: 'source,external_booking_uid'/)
  })

  it('lets staff remove or reschedule a provider-managed appointment in Cornerstone', () => {
    const route = read('app/api/admin/scheduling/appointments/route.ts')
    const drawer = read('app/admin/calendar/EventPrepDrawer.tsx')
    const calendar = read('app/admin/calendar/CalendarClient.tsx')
    const correction = read('lib/appointments/externalCorrection.ts')

    expect(route).toContain('correctExternalAppointment')
    expect(route).toContain('action === \'cancel\' || action === \'reschedule\'')
    expect(drawer).toContain('Managed in {externalSourceLabel(appointment.source)}')
    expect(drawer).toContain('Remove…')
    expect(drawer).toContain('onReschedule(appointment)')
    expect(calendar).toContain('Meeting removed from Cornerstone')
    expect(calendar).toContain('Meeting time updated in Cornerstone')
    expect(calendar).not.toMatch(/a\.status === 'scheduled' && !isExternallyManagedSource\(a\.source\)/)
    expect(correction).not.toMatch(/sendEmail|enqueueLawmatics/)
  })

  it('allows Cal.com as a second read-only calendar source', () => {
    const migration = read('supabase/migrations/20261221000000_calcom_appointment_calendar_sync.sql')
    expect(migration).toMatch(/check \(source in \('public', 'portal', 'admin', 'calendly', 'calcom'\)\)/i)
  })
})

describe('externally managed appointment sources', () => {
  it('labels Calendly and Cal.com and treats native sources as editable', async () => {
    const { externalSourceLabel, isExternallyManagedSource } = await import('@/lib/appointments/types')
    expect(externalSourceLabel('calendly')).toBe('Calendly')
    expect(externalSourceLabel('calcom')).toBe('Cal.com')
    for (const source of ['public', 'portal', 'admin', null, undefined]) {
      expect(isExternallyManagedSource(source)).toBe(false)
    }
    expect(isExternallyManagedSource('calcom')).toBe(true)
  })
})
