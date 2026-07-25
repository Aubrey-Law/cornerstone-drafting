import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('target signing date and time', () => {
  it('uses a date-time input only for the target signing field', () => {
    const card = read('app/admin/matters/[id]/MatterEssentialsCard.tsx')
    expect(card).toContain('<FieldLabel>Target signing date</FieldLabel>')
    expect(card).toContain('type="datetime-local"')
    expect(card).toContain("'scheduled_signing_date'")
    expect(card).toContain('new Date(raw).toISOString()')
    expect(card).toContain('<FieldLabel>Signing date</FieldLabel>')
    expect(card).toContain('type="date"')
  })

  it('stores target signing as a timezone-aware timestamp', () => {
    const migration = read('supabase/migrations/20260725023005_target_signing_datetime.sql')
    expect(migration).toContain('scheduled_signing_date type timestamptz')
    expect(migration).toContain("at time zone 'America/New_York'")
  })

  it('validates target signing timestamps at the API boundary', () => {
    const route = read('app/api/admin/matter-details/route.ts')
    expect(route).toContain("field === 'scheduled_signing_date'")
    expect(route).toContain('Invalid target signing date and time')
    expect(route).toContain('toISOString()')
  })

  it('preserves the appointment time when Cal.com schedules a signing', () => {
    const sync = read('lib/calcom/sync.ts')
    expect(sync).toContain('scheduled_signing_date: startTimestamp')
    expect(sync).toContain('design_meeting_date: dateOnly')
  })
})
