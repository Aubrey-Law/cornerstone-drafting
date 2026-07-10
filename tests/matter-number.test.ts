import { describe, expect, it } from 'vitest'
import {
  clientNameMatterSlug,
  formatMatterNumberWithClient,
  matterNumberPrefix,
  parseMatterSeq,
} from '@/lib/matterNumber'

describe('matter number formatting', () => {
  it('builds a client slug from the last name', () => {
    expect(clientNameMatterSlug('Ada Lovelace')).toBe('Lovelace')
    expect(clientNameMatterSlug("Mary O'Brien")).toBe('OBrien')
    expect(clientNameMatterSlug('')).toBe('Client')
  })

  it('formats year, practice area code, client slug, and sequence', () => {
    expect(formatMatterNumberWithClient(2026, 'EP', 'Smith', 1)).toBe('2026-EP-Smith-001')
    expect(formatMatterNumberWithClient(2026, 'EPLP', 'Smith', 12)).toBe('2026-EPLP-Smith-012')
  })

  it('parses the numeric sequence from a prefixed matter number', () => {
    const prefix = matterNumberPrefix(2026, 'EP', 'Smith')
    expect(parseMatterSeq('2026-EP-Smith-007', prefix)).toBe(7)
    expect(parseMatterSeq('2026-EP-Smith', prefix)).toBeNull()
    expect(parseMatterSeq('2026-EP-007', '2026-EP-')).toBe(7)
  })
})
