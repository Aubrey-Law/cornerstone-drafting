import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import { extractStyleSetFromDocx } from '@/lib/styleSets/extract'
import { applyStyleSetToPart } from '@/lib/styleSets/applyStyleSet'
import { PRESERVE, parseStyleSetSettings } from '@/lib/styleSets/schema'

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function styles(body: string) {
  return `<w:styles ${NS}>${body}</w:styles>`
}

function docx(parts: Record<string, string>): Buffer {
  const zip = new PizZip()
  for (const [name, content] of Object.entries(parts)) zip.file(name, content)
  return Buffer.from(zip.generate({ type: 'uint8array' }))
}

const DOCUMENT = `<w:document ${NS}><w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`

const STYLES = styles(
  [
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>',
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>',
    '<w:rPr><w:rFonts w:ascii="Garamond"/><w:sz w:val="24"/></w:rPr>',
    '<w:pPr><w:jc w:val="both"/><w:spacing w:before="0" w:after="120"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>',
    '<w:rPr><w:rFonts w:ascii="Garamond"/><w:b/><w:sz w:val="36"/></w:rPr>',
    '<w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>',
    '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>',
  ].join(''),
)

const NUMBERING = `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
<w:lvl w:ilvl="2"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/>
<w:pPr><w:ind w:left="360" w:hanging="0"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond" w:cs="Garamond"/></w:rPr></w:lvl>
</w:abstractNum></w:numbering>`

function extract(parts: Partial<Record<string, string>> = {}) {
  return extractStyleSetFromDocx(
    docx({
      'word/document.xml': DOCUMENT,
      'word/styles.xml': STYLES,
      'word/numbering.xml': NUMBERING,
      ...parts,
    } as Record<string, string>),
  )
}

describe('extracting body formatting', () => {
  it('prefers Normal over docDefaults, which is how Word resolves it', () => {
    // Reading the fallback first would report an 11pt document as 11pt when
    // every paragraph in it says 12.
    const { settings } = extract()
    expect(settings.body.fontFamily).toBe('Garamond')
    expect(settings.body.fontSizePt).toBe(12)
  })

  it('falls back to docDefaults for anything Normal does not state', () => {
    const { settings } = extract()
    expect(settings.body.lineSpacing).toBe(1.15) // 276/240, from pPrDefault
  })

  it('reads alignment and spacing from the style that states them', () => {
    const { settings } = extract()
    expect(settings.body.alignment).toBe('justify')
    expect(settings.body.spaceAfterPt).toBe(6)
    expect(settings.body.spaceBeforePt).toBe(0)
  })

  it('reports preserve for what the document never says', () => {
    // An extracted style set describes what is there; it is not a filled-in
    // form, so an unstated field must not become a guess.
    const bare = extract({ 'word/styles.xml': styles('') })
    expect(bare.settings.body.fontFamily).toBe(PRESERVE)
    expect(bare.settings.body.lineSpacing).toBe(PRESERVE)
    expect(bare.settings.body.bold).toBe(PRESERVE)
  })

  it('ignores a line rule that is not a spacing multiple', () => {
    // Under "exact" the value is a fixed height in twips, which this schema
    // cannot express; reading it as a multiple would give 11.5x line spacing.
    const exact = extract({
      'word/styles.xml': styles(
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="276" w:lineRule="exact"/></w:pPr></w:style>',
      ),
    })
    expect(exact.settings.body.lineSpacing).toBe(PRESERVE)
  })
})

describe('extracting title formatting', () => {
  it('takes the largest title-family style, not the first', () => {
    const { settings } = extract()
    expect(settings.title.fontSizePt).toBe(18)
    expect(settings.title.bold).toBe(true)
    expect(settings.title.alignment).toBe('center')
  })

  it('says so when there is no title style rather than inventing one', () => {
    const { settings, notes } = extract({
      'word/styles.xml': styles('<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'),
    })
    expect(settings.title.fontSizePt).toBe(PRESERVE)
    expect(notes.join(' ')).toContain('No title style')
  })
})

describe('extracting numbering', () => {
  it('recognises a format from the numFmt and its surrounding text together', () => {
    const { settings } = extract()
    expect(settings.level3.numberingFormat).toBe('lowerLetterParenthetical')
    expect(settings.level3.indentLeftPt).toBe(18)
    expect(settings.level3.hangingPt).toBe(0)
    expect(settings.level3.fontFamily).toBe('Garamond')
  })

  it('preserves a numbering shape it has no name for', () => {
    // Rounding "1)" to "(1)" would rewrite the document's numbering on the next
    // generation for a reason nobody asked for.
    const odd = NUMBERING.replace('<w:lvlText w:val="(%3)"/>', '<w:lvlText w:val="%3)"/>')
    const { settings } = extract({ 'word/numbering.xml': odd })
    expect(settings.level3.numberingFormat).toBe(PRESERVE)
    // The indent is still read — an unrecognised format does not lose the rest.
    expect(settings.level3.indentLeftPt).toBe(18)
  })
})

describe('extracting page setup', () => {
  it('reads paper size, orientation and margins', () => {
    const { settings } = extract()
    expect(settings.page.paperSize).toBe('letter')
    expect(settings.page.orientation).toBe('portrait')
    expect(settings.page.margins.leftPt).toBe(72)
  })

  it('recognises a landscape page as the same paper turned sideways', () => {
    const landscape = DOCUMENT.replace(
      '<w:pgSz w:w="12240" w:h="15840"/>',
      '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>',
    )
    const { settings } = extract({ 'word/document.xml': landscape })
    expect(settings.page.paperSize).toBe('letter')
    expect(settings.page.orientation).toBe('landscape')
  })

  it('preserves a paper size it does not have a name for', () => {
    const odd = DOCUMENT.replace('<w:pgSz w:w="12240" w:h="15840"/>', '<w:pgSz w:w="9000" w:h="13000"/>')
    const { settings } = extract({ 'word/document.xml': odd })
    expect(settings.page.paperSize).toBe(PRESERVE)
    // Orientation is still known even when the size is not a standard one.
    expect(settings.page.orientation).toBe('portrait')
  })
})

describe('round trip', () => {
  /**
   * The property that justifies writing extraction against the same primitives
   * as application. Note what it is *not*: byte-identity.
   *
   * Extraction resolves the style cascade — `Normal` beats `docDefaults`,
   * because that is how Word decides what a paragraph looks like. Application
   * then imposes the resolved answer on both, because a style set applied to
   * some *other* template has to win there too. So putting a document's own
   * settings back into it normalises its cascade: the page looks the same and
   * the XML does not.
   *
   * Being a fixed point is the real guarantee. Extract, apply, extract again,
   * and nothing has drifted — which is what makes it safe to regenerate a
   * document repeatedly under the same style set.
   */
  it('is a fixed point: applying extracted settings does not change what extracts', () => {
    const first = extract().settings
    const applied = docx({
      'word/document.xml': applyStyleSetToPart('word/document.xml', DOCUMENT, first),
      'word/styles.xml': applyStyleSetToPart('word/styles.xml', STYLES, first),
      'word/numbering.xml': applyStyleSetToPart('word/numbering.xml', NUMBERING, first),
    })
    expect(extractStyleSetFromDocx(applied).settings).toEqual(first)
  })

  it('changes nothing at all in the parts that carry no cascade', () => {
    // Numbering levels and section properties state their values outright, with
    // no inheritance to resolve, so for those the no-op is exact — provided the
    // source states them fully. Application also completes a partial
    // specification (an `rFonts` naming only `w:ascii` gains `w:hAnsi` and
    // `w:cs`), which preserves the font while changing the bytes.
    const { settings } = extract()
    expect(applyStyleSetToPart('word/numbering.xml', NUMBERING, settings)).toBe(NUMBERING)
    expect(applyStyleSetToPart('word/document.xml', DOCUMENT, settings)).toBe(DOCUMENT)
  })

  it('leaves the document looking the same, even where the XML moved', () => {
    // The cascade normalisation above must not change the winning value: what
    // Normal said before is what Normal says after.
    const { settings } = extract()
    const after = applyStyleSetToPart('word/styles.xml', STYLES, settings)
    const normalAfter = after.slice(after.indexOf('w:styleId="Normal"'), after.indexOf('w:styleId="Title"'))
    expect(normalAfter).toContain('w:ascii="Garamond"')
    expect(normalAfter).toContain('<w:sz w:val="24"/>')
    expect(normalAfter).toContain('w:val="both"')
  })

  it('recovers the settings that were applied to a document', () => {
    const written = parseStyleSetSettings({
      body: { fontFamily: 'Garamond', fontSizePt: 12, alignment: 'justify', lineSpacing: 2 },
      title: { fontSizePt: 14, bold: true },
      level3: { numberingFormat: 'lowerLetterParenthetical', indentLeftPt: 18, hangingPt: 0 },
    })
    const applied = docx({
      'word/document.xml': DOCUMENT,
      'word/styles.xml': applyStyleSetToPart('word/styles.xml', STYLES, written),
      'word/numbering.xml': applyStyleSetToPart('word/numbering.xml', NUMBERING, written),
    })

    const { settings } = extractStyleSetFromDocx(applied)
    expect(settings.body.fontSizePt).toBe(12)
    expect(settings.body.alignment).toBe('justify')
    expect(settings.body.lineSpacing).toBe(2)
    expect(settings.title.fontSizePt).toBe(14)
    expect(settings.level3.numberingFormat).toBe('lowerLetterParenthetical')
    expect(settings.level3.hangingPt).toBe(0)
  })
})

describe('what extraction cannot promise', () => {
  it('warns when a document uses more fonts than a style set can express', () => {
    const mixed = styles(
      [
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:style>',
      ].join(''),
    )
    const { notes } = extract({ 'word/styles.xml': mixed })
    expect(notes.join(' ')).toContain('2 fonts')
  })

  it('rejects a file that is not a Word document', () => {
    expect(() => extractStyleSetFromDocx(Buffer.from('not a zip'))).toThrow(/readable \.docx/)
    expect(() => extractStyleSetFromDocx(docx({ 'hello.txt': 'hi' }))).toThrow(/Word document/)
  })

  it('reads a document that has no numbering or styles part at all', () => {
    const minimal = extractStyleSetFromDocx(docx({ 'word/document.xml': DOCUMENT }))
    expect(minimal.settings.page.paperSize).toBe('letter')
    expect(minimal.notes.join(' ')).toContain('no styles')
  })
})
