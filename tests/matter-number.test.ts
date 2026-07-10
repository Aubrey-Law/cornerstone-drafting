import { describe, expect, it } from 'vitest'
import {
  clientNameMatterSlug,
  formatMatterNumberWithClient,
  matterNumberPracticeAreaPrefix,
  matterNumberPrefix,
  parseMatterSeq,
  parseMatterSeqInPracticeArea,
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

  it('parses sequence across a practice area and year regardless of client slug', () => {
    const areaPrefix = matterNumberPracticeAreaPrefix(2026, 'EP')
    expect(areaPrefix).toBe('2026-EP-')
    expect(parseMatterSeqInPracticeArea('2026-EP-Smith-007', 2026, 'EP')).toBe(7)
    expect(parseMatterSeqInPracticeArea('2026-EP-Jones-012', 2026, 'EP')).toBe(12)
    expect(parseMatterSeqInPracticeArea('2026-EP-007', 2026, 'EP')).toBe(7)
    expect(parseMatterSeqInPracticeArea('2026-EPLP-Smith-003', 2026, 'EP')).toBeNull()
    expect(parseMatterSeqInPracticeArea('2026-EP-Smith', 2026, 'EP')).toBeNull()
  })
})
