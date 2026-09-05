import { describe, expect, it } from 'vitest'
import { selectAppointmentRows } from '@/lib/fiduciary/repository'

const row = (over: { matter_id?: string | null; client_intake_id?: string | null; tag: string }) => ({
  matter_id: null,
  client_intake_id: null,
  ...over,
})

/**
 * Appointments are recorded twice over a matter's life: once at intake, before
 * a matter exists, and again against the matter as the design settles. Showing
 * both would name two different people for one office.
 */
describe('selectAppointmentRows', () => {
  it('uses the matter’s own rows when it has any', () => {
    const rows = [
      row({ matter_id: 'm-1', tag: 'matter' }),
      row({ client_intake_id: 'i-1', tag: 'intake' }),
    ]
    expect(selectAppointmentRows(rows, 'm-1', 'i-1').map((r) => r.tag)).toEqual(['matter'])
  })

  it('falls back to the intake answer when the matter has none', () => {
    const rows = [row({ client_intake_id: 'i-1', tag: 'intake' })]
    expect(selectAppointmentRows(rows, 'm-1', 'i-1').map((r) => r.tag)).toEqual(['intake'])
  })

  /**
   * The reason this is all-or-nothing rather than a merge: a matter that named
   * a new trustee has superseded the intake's answer, and mixing the two would
   * resurrect the person who was replaced.
   */
  it('does not mix the two, even when the matter names fewer people', () => {
    const rows = [
      row({ matter_id: 'm-1', tag: 'matter-only' }),
      row({ client_intake_id: 'i-1', tag: 'intake-one' }),
      row({ client_intake_id: 'i-1', tag: 'intake-two' }),
    ]
    expect(selectAppointmentRows(rows, 'm-1', 'i-1').map((r) => r.tag)).toEqual(['matter-only'])
  })

  it('ignores another matter’s rows', () => {
    const rows = [row({ matter_id: 'm-2', tag: 'other' }), row({ client_intake_id: 'i-1', tag: 'intake' })]
    expect(selectAppointmentRows(rows, 'm-1', 'i-1').map((r) => r.tag)).toEqual(['intake'])
  })

  it('finds nothing when neither matches', () => {
    expect(selectAppointmentRows([row({ matter_id: 'm-9', tag: 'x' })], 'm-1', 'i-1')).toEqual([])
  })
})
