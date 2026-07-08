import { describe, expect, it } from 'vitest'
import { parseUpdatedAt, updatedAtMatches } from '@/lib/designSheet/updatedAt'

describe('design sheet updated_at helpers', () => {
  it('parses JS ISO and Postgres timestamptz strings to the same instant', () => {
    const js = '2026-07-08T17:32:00.123Z'
    const pg = '2026-07-08T17:32:00.123456+00:00'
    expect(parseUpdatedAt(js)).toBe(parseUpdatedAt(pg))
  })

  it('matches equivalent timestamps across formats', () => {
    expect(updatedAtMatches(
      '2026-07-08T17:32:00.123Z',
      '2026-07-08T17:32:00.123+00:00',
    )).toBe(true)
  })

  it('rejects different instants', () => {
    expect(updatedAtMatches(
      '2026-07-08T17:32:00.123Z',
      '2026-07-08T17:32:01.123Z',
    )).toBe(false)
  })
})
