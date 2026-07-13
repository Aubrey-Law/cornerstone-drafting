import { describe, expect, it } from 'vitest'
import {
  normalizePracticeArea,
  parsePracticeArea,
  practiceAreaLabel,
  PRACTICE_AREA_OPTIONS,
} from '@/lib/practiceArea'

describe('practice area options', () => {
  it('exposes the three matter page choices', () => {
    expect(PRACTICE_AREA_OPTIONS.map(option => option.label)).toEqual([
      'Estate Planning',
      'Estate Planning - LP',
      'Probate',
    ])
  })

  it('normalizes legacy labels', () => {
    expect(normalizePracticeArea('Estate Planning - LP')).toBe('EP-LP')
    expect(practiceAreaLabel('EP-LP')).toBe('Estate Planning - LP')
    expect(practiceAreaLabel('Probate')).toBe('Probate')
    expect(parsePracticeArea('PROBATE')).toBe('Probate')
    expect(parsePracticeArea('elder')).toBeNull()
  })
})
