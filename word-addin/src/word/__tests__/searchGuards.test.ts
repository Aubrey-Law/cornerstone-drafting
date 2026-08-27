import { describe, expect, it } from 'vitest'
import { isSearchable, normalizeTypography } from '../applyTrackedEdits'
import { stripStructuralMarkers } from '../readDocument'
import { parseEditsBlock } from '../editTypes'

describe('isSearchable', () => {
  it('accepts an ordinary passage', () => {
    expect(isSearchable('the Trustee shall distribute')).toBe(true)
  })

  it('rejects text past Word’s 255-character search limit', () => {
    expect(isSearchable('x'.repeat(255))).toBe(true)
    expect(isSearchable('x'.repeat(256))).toBe(false)
  })

  it('rejects text spanning a paragraph break, which search can never match', () => {
    expect(isSearchable('first line\nsecond line')).toBe(false)
    expect(isSearchable('first line\rsecond line')).toBe(false)
  })

  it('rejects "^", which leads an escape sequence in Word’s search syntax', () => {
    expect(isSearchable('clause ^13')).toBe(false)
  })

  it('rejects empty text', () => {
    expect(isSearchable('')).toBe(false)
  })
})

describe('normalizeTypography', () => {
  it('maps the punctuation models most often get wrong', () => {
    expect(normalizeTypography('the “Trust”—as amended…')).toBe('the "Trust"-as amended...')
    expect(normalizeTypography('Settlor’s')).toBe("Settlor's")
  })

  it('leaves ASCII punctuation alone', () => {
    const ascii = 'the "Trust" - as amended...'
    expect(normalizeTypography(ascii)).toBe(ascii)
  })
})

describe('stripStructuralMarkers', () => {
  it('removes a heading marker the renderer added', () => {
    expect(stripStructuralMarkers('## ARTICLE IV')).toBe('ARTICLE IV')
  })

  it('removes a list marker', () => {
    expect(stripStructuralMarkers('  (a) to sell any asset')).toBe('to sell any asset')
    expect(stripStructuralMarkers('• any asset')).toBe('any asset')
  })

  it('strips only one layer, so real numbering survives', () => {
    // "# 1. Introduction" is a heading whose text genuinely starts "1.".
    expect(stripStructuralMarkers('# 1. Introduction')).toBe('1. Introduction')
  })

  it('returns unmarked text unchanged', () => {
    expect(stripStructuralMarkers('The Trustee shall act')).toBe('The Trustee shall act')
  })
})

describe('parseEditsBlock (pane copy)', () => {
  it('matches the server parser on the cases that matter', () => {
    const reply = '<EDITS>\n[{"original":"A","replacement":"B","reason":"r"}]\n</EDITS>\nDone.'
    const parsed = parseEditsBlock(reply)
    expect(parsed.edits).toEqual([{ original: 'A', replacement: 'B', reason: 'r' }])
    expect(parsed.prose).toBe('Done.')
  })
})
