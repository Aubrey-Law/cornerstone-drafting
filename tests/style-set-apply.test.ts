import { describe, expect, it } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import { AUBREY_HOUSE_STYLE_SET } from '@/lib/styleSets/defaults'
import {
  applyNumberingLevels,
  applyPageSetup,
  applyStyleSetToPart,
  applyTitleStyle,
  applyBodyStyle,
} from '@/lib/styleSets/applyStyleSet'
import { PRESERVE_ALL_SETTINGS, parseStyleSetSettings } from '@/lib/styleSets/schema'
import { LEGACY_GARAMOND_STYLE_SET } from '@/lib/styleSets/defaults'

/**
 * Word's response to malformed OOXML is a flat "unreadable content" dialog with
 * no indication of the cause, so a structural mistake here would surface only
 * when a client opened their trust. Validating well-formedness after every
 * transform is the cheapest guard available against that.
 */
function expectWellFormed(xml: string) {
  expect(XMLValidator.validate(xml)).toBe(true)
}

/** The pre-style-set implementation, kept verbatim as the equivalence oracle. */
const LEGACY_RFONTS_RE = /<w:rFonts\b[^>]*\/>/g
const LEGACY_PARTS = /^word\/(document\.xml|styles\.xml|(header|footer)\d*\.xml)$/
function normalizeFontsToGaramond(xml: string): string {
  return xml.replace(
    LEGACY_RFONTS_RE,
    '<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond" w:cs="Garamond"/>',
  )
}

const STYLES_XML = [
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>',
  '<w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>',
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>',
  '<w:rPr><w:rFonts w:ascii="Times New Roman"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>',
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="SubtitleNote"><w:name w:val="Subtitle Note"/>',
  '<w:rPr><w:sz w:val="22"/></w:rPr></w:style>',
  '<w:style w:type="numbering" w:styleId="CurrentList3"><w:name w:val="Current List 3"/>',
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>',
  '</w:styles>',
].join('')

describe('legacy equivalence', () => {
  // The default style set must be indistinguishable from the code it replaced,
  // or introducing the engine silently changes every document the firm has.
  const parts: Array<[string, string]> = [
    ['word/document.xml', '<w:document><w:body><w:r><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr></w:r></w:body></w:document>'],
    ['word/styles.xml', STYLES_XML],
    ['word/header1.xml', '<w:hdr><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:r></w:hdr>'],
    ['word/footer2.xml', '<w:ftr><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:r></w:ftr>'],
    ['word/numbering.xml', '<w:numbering><w:abstractNum><w:lvl w:ilvl="0"><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:lvl></w:abstractNum></w:numbering>'],
    ['word/settings.xml', '<w:settings><w:rFonts w:ascii="Arial"/></w:settings>'],
  ]

  for (const [partName, xml] of parts) {
    it(`matches the old Garamond sweep for ${partName}`, () => {
      const expected = LEGACY_PARTS.test(partName) ? normalizeFontsToGaramond(xml) : xml
      expect(applyStyleSetToPart(partName, xml, LEGACY_GARAMOND_STYLE_SET)).toBe(expected)
    })
  }

  it('leaves every part untouched when nothing is overridden', () => {
    for (const [partName, xml] of parts) {
      expect(applyStyleSetToPart(partName, xml, PRESERVE_ALL_SETTINGS)).toBe(xml)
    }
  })
})

describe('well-formedness', () => {
  const numbering = [
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:abstractNum w:abstractNumId="0">',
    '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/>',
    '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:firstLine="360"/></w:pPr>',
    '<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:lvl>',
    '</w:abstractNum></w:numbering>',
  ].join('')
  const document = [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>',
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
  ].join('')

  const everything = parseStyleSetSettings({
    body: { fontFamily: 'Garamond', fontSizePt: 12, bold: false, alignment: 'justify', lineSpacing: 1.5, spaceBeforePt: 0, spaceAfterPt: 6 },
    title: { fontSizePt: 14, bold: true, alignment: 'center' },
    level1: { numberingFormat: 'hierarchicalDecimal', indentLeftPt: 0, hangingPt: 0 },
    level3: { numberingFormat: 'lowerLetterParenthetical', indentLeftPt: 18, hangingPt: 0, fontFamily: 'Garamond' },
    page: { paperSize: 'legal', orientation: 'landscape', margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
  })

  for (const [name, xml] of [
    ['word/styles.xml', STYLES_XML],
    ['word/numbering.xml', numbering],
    ['word/document.xml', document],
  ] as Array<[string, string]>) {
    it(`leaves ${name} well-formed under a fully specified style set`, () => {
      expectWellFormed(applyStyleSetToPart(name, xml, everything))
    })

    it(`leaves ${name} well-formed under the house style`, () => {
      expectWellFormed(applyStyleSetToPart(name, xml, AUBREY_HOUSE_STYLE_SET))
    })
  }

  it('is idempotent, so regenerating a document does not compound the edits', () => {
    const once = applyStyleSetToPart('word/styles.xml', STYLES_XML, everything)
    expect(applyStyleSetToPart('word/styles.xml', once, everything)).toBe(once)
  })
})

describe('body style', () => {
  it('sets the size on both docDefaults and Normal', () => {
    // docDefaults governs inheritance; Normal is what body paragraphs carry.
    // Setting only one leaves half the templates visibly unchanged.
    const result = applyBodyStyle(
      STYLES_XML,
      parseStyleSetSettings({ body: { fontSizePt: 12 } }).body,
    )
    expect(result).toContain('<w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>')
    const normal = result.slice(result.indexOf('w:styleId="Normal"'), result.indexOf('w:styleId="Title"'))
    expect(normal).toContain('<w:sz w:val="24"/>')
  })

  it('merges line spacing into the existing paragraph spacing', () => {
    const result = applyBodyStyle(
      STYLES_XML,
      parseStyleSetSettings({ body: { lineSpacing: 2 } }).body,
    )
    expect(result).toContain('w:after="160"')
    expect(result).toContain('w:line="480"')
    expect(result).toContain('w:lineRule="auto"')
  })
})

describe('title style', () => {
  const capped = parseStyleSetSettings({ title: { fontSizePt: 14 } }).title

  it('caps the styles that are actually oversized', () => {
    const result = applyTitleStyle(STYLES_XML, capped)
    const title = result.slice(result.indexOf('w:styleId="Title"'), result.indexOf('w:styleId="Heading1"'))
    expect(title).toContain('<w:sz w:val="28"/>')
  })

  it('caps Heading 1, which this template family reuses for divider titles', () => {
    const result = applyTitleStyle(STYLES_XML, capped)
    const heading = result.slice(result.indexOf('w:styleId="Heading1"'), result.indexOf('w:styleId="SubtitleNote"'))
    expect(heading).toContain('<w:sz w:val="28"/>')
  })

  it('does not inflate a small style that merely has "title" in its name', () => {
    // "Subtitle Note" at 11pt is not a title; growing it to 14pt is worse than
    // leaving it alone.
    const result = applyTitleStyle(STYLES_XML, capped)
    const subtitle = result.slice(result.indexOf('w:styleId="SubtitleNote"'), result.indexOf('w:styleId="CurrentList3"'))
    expect(subtitle).toContain('<w:sz w:val="22"/>')
    expect(subtitle).not.toContain('w:val="28"')
  })

  it('skips list-definition styles, which are artifacts rather than titles', () => {
    const result = applyTitleStyle(STYLES_XML, capped)
    const list = result.slice(result.indexOf('w:styleId="CurrentList3"'))
    expect(list).toContain('<w:sz w:val="32"/>')
  })
})

describe('numbering levels', () => {
  const numbering = [
    '<w:numbering>',
    '<w:abstractNum w:abstractNumId="0">',
    '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>',
    '<w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/>',
    '<w:pPr><w:ind w:left="720" w:firstLine="360"/></w:pPr></w:lvl>',
    '</w:abstractNum>',
    '<w:abstractNum w:abstractNumId="1">',
    '<w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/></w:lvl>',
    '</w:abstractNum>',
    '</w:numbering>',
  ].join('')

  const levels = parseStyleSetSettings({
    level3: { numberingFormat: 'lowerLetterParenthetical', indentLeftPt: 18, hangingPt: 0 },
  })

  it('rewrites the format and its surrounding text together', () => {
    const result = applyNumberingLevels(
      numbering,
      { level1: levels.level1, level2: levels.level2, level3: levels.level3 },
      'preserve',
    )
    expect(result).toContain('<w:numFmt w:val="lowerLetter"/>')
    expect(result).toContain('<w:lvlText w:val="(%3)"/>')
  })

  it('applies to every abstract numbering definition, not just the first', () => {
    // A portfolio carries one list instance per sub-document; fixing only the
    // first leaves the will formatted and the trust not.
    const result = applyNumberingLevels(
      numbering,
      { level1: levels.level1, level2: levels.level2, level3: levels.level3 },
      'preserve',
    )
    expect(result.match(/w:val="lowerLetter"/g)).toHaveLength(2)
  })

  it('clears a firstLine indent when it sets a hanging one', () => {
    // The two are the same measurement in opposite directions; leaving both
    // lets Word pick, and the level lands somewhere nobody asked for.
    const result = applyNumberingLevels(
      numbering,
      { level1: levels.level1, level2: levels.level2, level3: levels.level3 },
      'preserve',
    )
    expect(result).toContain('w:hanging="0"')
    expect(result).toContain('w:left="360"')
    expect(result).not.toContain('w:firstLine')
  })

  it('leaves untargeted levels alone', () => {
    const result = applyNumberingLevels(
      numbering,
      { level1: levels.level1, level2: levels.level2, level3: levels.level3 },
      'preserve',
    )
    expect(result).toContain('<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>')
  })

  it('renders no number at all when numbering is switched off', () => {
    const result = applyNumberingLevels(
      numbering,
      { level1: levels.level1, level2: levels.level2, level3: levels.level3 },
      false,
    )
    expect(result).toContain('<w:numFmt w:val="none"/>')
    expect(result).toContain('<w:lvlText w:val=""/>')
  })
})

describe('page setup', () => {
  const sectPr = '<w:document><w:body><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'

  it('overrides only the margins it was given', () => {
    const page = parseStyleSetSettings({ page: { margins: { leftPt: 90 } } }).page
    const result = applyPageSetup(sectPr, page)
    expect(result).toContain('w:left="1800"')
    expect(result).toContain('w:right="1440"')
  })

  it('swaps the dimensions for landscape, not just the orientation attribute', () => {
    // Word honours the dimensions and treats w:orient as a hint, so setting
    // only the attribute yields a page that prints portrait.
    const page = parseStyleSetSettings({ page: { orientation: 'landscape' } }).page
    const result = applyPageSetup(sectPr, page)
    expect(result).toContain('w:w="15840"')
    expect(result).toContain('w:h="12240"')
    expect(result).toContain('w:orient="landscape"')
  })

  it('does not double-swap a template that was already landscape', () => {
    const landscape = sectPr.replace('<w:pgSz w:w="12240" w:h="15840"/>', '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>')
    const page = parseStyleSetSettings({ page: { paperSize: 'letter' } }).page
    const result = applyPageSetup(landscape, page)
    expect(result).toContain('w:w="15840"')
    expect(result).toContain('w:h="12240"')
  })

  it('clears a stale landscape attribute when going back to portrait', () => {
    const landscape = sectPr.replace('<w:pgSz w:w="12240" w:h="15840"/>', '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>')
    const page = parseStyleSetSettings({ page: { orientation: 'portrait' } }).page
    const result = applyPageSetup(landscape, page)
    expect(result).toContain('w:orient="portrait"')
    expect(result).toContain('w:w="12240"')
  })

  it('applies to every section, including a mid-document break', () => {
    const twoSections = sectPr.replace('</w:body>', '<w:p><w:pPr><w:sectPr><w:pgMar w:left="1440"/></w:sectPr></w:pPr></w:p></w:body>')
    const page = parseStyleSetSettings({ page: { margins: { leftPt: 90 } } }).page
    const result = applyPageSetup(twoSections, page)
    expect(result.match(/w:left="1800"/g)).toHaveLength(2)
  })

  it('does nothing when page setup is entirely preserved', () => {
    expect(applyPageSetup(sectPr, PRESERVE_ALL_SETTINGS.page)).toBe(sectPr)
  })
})
