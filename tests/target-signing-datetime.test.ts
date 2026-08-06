import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('target signing date', () => {
  it('uses separate date-only controls for target and actual signing', () => {
    const card = read('app/admin/matters/[id]/MatterDetailsCard.tsx')
    expect(card).toContain('<FieldLabel>Target signing date</FieldLabel>')
    expect(card).toContain('type="date"')
    expect(card).toContain("'scheduled_signing_date'")
    expect(card).toContain('normalizeTargetSigningDate')
    expect(card).toContain('<FieldLabel>Signing date</FieldLabel>')
  })

  it('stores target signing as a timezone-aware timestamp', () => {
    const migration = read('supabase/migrations/20260725023005_target_signing_datetime.sql')
    expect(migration).toContain('scheduled_signing_date type timestamptz')
    expect(migration).toContain("at time zone 'America/New_York'")
  })

  it('normalizes UI date-only values to noon UTC at the API boundary', () => {
    const route = read('app/api/admin/matter-details/route.ts')
    expect(route).toContain("field === 'scheduled_signing_date'")
    expect(route).toContain('normalizeTargetSigningDate')
    expect(route).toContain('Invalid target signing date')
  })

  it('preserves the appointment time when a provider webhook schedules a signing', () => {
    const sync = read('lib/bookings/sync.ts')
    expect(sync).toContain('scheduled_signing_date: startTimestamp')
    expect(sync).toContain('design_meeting_date: dateOnly')
  })
})
