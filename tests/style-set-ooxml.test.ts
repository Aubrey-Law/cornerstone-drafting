import { describe, expect, it } from 'vitest'
import {
  findDirectChild,
  findElementSpan,
  lineSpacingToTwentieths,
  numberingLevelXmlValues,
  ptToHalfPoints,
  ptToTwips,
  upsertEmptyChild,
  withChildContainer,
} from '@/lib/styleSets/ooxml'

describe('unit conversion', () => {
  it('converts points to the twentieths OOXML actually stores', () => {
    expect(ptToHalfPoints(14)).toBe(28)
    expect(ptToHalfPoints(11.5)).toBe(23)
    expect(ptToTwips(18)).toBe(360) // 0.25 inch
    expect(ptToTwips(72)).toBe(1440) // 1 inch
  })

  it('converts a line-spacing multiple to 240ths of a line', () => {
    expect(lineSpacingToTwentieths(1)).toBe(240)
    expect(lineSpacingToTwentieths(1.5)).toBe(360)
    expect(lineSpacingToTwentieths(2)).toBe(480)
  })
})

describe('numbering formats', () => {
  it('builds a hierarchical decimal that names every ancestor counter', () => {
    expect(numberingLevelXmlValues('hierarchicalDecimal', 0)).toEqual({
      numFmt: 'decimal',
      lvlText: '%1.',
    })
    expect(numberingLevelXmlValues('hierarchicalDecimal', 2)).toEqual({
      numFmt: 'decimal',
      lvlText: '%1.%2.%3',
    })
  })

  it('keeps the parenthetical forms self-contained so they restart per section', () => {
    expect(numberingLevelXmlValues('lowerLetterParenthetical', 2)).toEqual({
      numFmt: 'lowerLetter',
      lvlText: '(%3)',
    })
    expect(numberingLevelXmlValues('upperRoman', 0)).toEqual({
      numFmt: 'upperRoman',
      lvlText: '%1.',
    })
  })
})

describe('element scanning', () => {
  it('does not mistake a longer tag for the one it was asked for', () => {
    // w:lvlText, w:lvlJc and w:lvlRestart all start with "w:lvl".
    const xml = '<w:lvl w:ilvl="0"><w:lvlText w:val="(%1)"/><w:lvlJc w:val="left"/></w:lvl>'
    const span = findElementSpan(xml, 'w:lvl')
    expect(span?.inner).toBe('<w:lvlText w:val="(%1)"/><w:lvlJc w:val="left"/>')
  })

  it('balances nesting rather than stopping at the first close tag', () => {
    const xml = '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r/></w:p>'
    expect(findElementSpan(xml, 'w:pPr')?.inner).toBe('<w:rPr><w:b/></w:rPr>')
  })

  it('finds only top-level children, so nested homonyms do not collide', () => {
    // w:pPr/w:spacing is paragraph spacing; w:rPr/w:spacing is letter spacing.
    // A first-match scan would confuse the two.
    const pPr = '<w:rPr><w:spacing w:val="20"/></w:rPr><w:spacing w:after="240"/>'
    const direct = findDirectChild(pPr, 'w:spacing')
    expect(direct?.openTag).toBe('<w:spacing w:after="240"/>')
  })
})

describe('upsertEmptyChild', () => {
  it('inserts a child at its schema position, not at the end', () => {
    // Word refuses to open a file whose w:rPr lists w:sz before w:b.
    const inner = '<w:rFonts w:ascii="Garamond"/><w:u w:val="single"/>'
    const result = upsertEmptyChild(inner, 'w:rPr', 'w:sz', { 'w:val': 28 })
    expect(result).toBe('<w:rFonts w:ascii="Garamond"/><w:sz w:val="28"/><w:u w:val="single"/>')
  })

  it('appends when nothing present outranks the new child', () => {
    const result = upsertEmptyChild('<w:rFonts w:ascii="Garamond"/>', 'w:rPr', 'w:sz', { 'w:val': 28 })
    expect(result).toBe('<w:rFonts w:ascii="Garamond"/><w:sz w:val="28"/>')
  })

  it('merges attributes instead of replacing the element', () => {
    // Overriding line spacing must not wipe the template's paragraph spacing.
    const inner = '<w:spacing w:before="120" w:after="240"/>'
    const result = upsertEmptyChild(inner, 'w:pPr', 'w:spacing', { 'w:line': 360, 'w:lineRule': 'auto' })
    expect(result).toContain('w:before="120"')
    expect(result).toContain('w:after="240"')
    expect(result).toContain('w:line="360"')
  })

  it('ranks siblings rather than their children', () => {
    // w:top inside w:pBdr must not be ranked against w:pPr's own schema.
    const inner = '<w:pBdr><w:top w:val="single"/></w:pBdr><w:jc w:val="left"/>'
    const result = upsertEmptyChild(inner, 'w:pPr', 'w:ind', { 'w:left': 360 })
    expect(result).toBe('<w:pBdr><w:top w:val="single"/></w:pBdr><w:ind w:left="360"/><w:jc w:val="left"/>')
  })

  it('escapes an attribute value that would otherwise break the XML', () => {
    const result = upsertEmptyChild('', 'w:rPr', 'w:rFonts', { 'w:ascii': 'Ampersand & "Quote"' })
    expect(result).toBe('<w:rFonts w:ascii="Ampersand &amp; &quot;Quote&quot;"/>')
  })
})

describe('withChildContainer', () => {
  it('creates a container the template never wrote', () => {
    const result = withChildContainer('<w:name w:val="Normal"/>', 'w:style', 'w:rPr', inner =>
      upsertEmptyChild(inner, 'w:rPr', 'w:sz', { 'w:val': 24 }),
    )
    expect(result).toContain('<w:rPr><w:sz w:val="24"/></w:rPr>')
  })

  it('edits a container that already exists, in place', () => {
    const result = withChildContainer('<w:rPr><w:b/></w:rPr>', 'w:style', 'w:rPr', inner =>
      upsertEmptyChild(inner, 'w:rPr', 'w:sz', { 'w:val': 24 }),
    )
    expect(result).toBe('<w:rPr><w:b/><w:sz w:val="24"/></w:rPr>')
  })

  it('replaces a self-closing container rather than leaving it beside the new one', () => {
    const result = withChildContainer('<w:rPr/>', 'w:style', 'w:rPr', inner =>
      upsertEmptyChild(inner, 'w:rPr', 'w:sz', { 'w:val': 24 }),
    )
    expect(result).toBe('<w:rPr><w:sz w:val="24"/></w:rPr>')
  })
})
