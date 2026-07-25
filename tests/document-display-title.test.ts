import { describe, expect, it } from 'vitest'
import { documentDisplayTitle } from '@/lib/documentDisplayTitle'

describe('document display title', () => {
  it('strips a leading ISO date, exact client prefix, extension, and separators', () => {
    expect(documentDisplayTitle(
      '2026-07-24_Jane_Smith_Revocable_Living_Trust.docx',
      'Jane Smith',
    )).toBe('Revocable Living Trust')
  })

  it('does not strip a partial or different client prefix', () => {
    expect(documentDisplayTitle('2026-07-24_Janet_Smith_Will.pdf', 'Jane Smith'))
      .toBe('Janet Smith Will')
  })

  it('keeps duplicate suffixes meaningful', () => {
    expect(documentDisplayTitle('2026-07-24-Jane Smith-Will (2).pdf', 'Jane Smith'))
      .toBe('Will (2)')
  })

  it('does not mutate or require the stored filename', () => {
    const filename = 'Original_File_Name.DOCX'
    documentDisplayTitle(filename, 'Jane Smith')
    expect(filename).toBe('Original_File_Name.DOCX')
  })
})
