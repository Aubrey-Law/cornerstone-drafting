import PizZip from 'pizzip'
import {
  NUMBERING_FORMATS,
  PRESERVE,
  parseStyleSetSettings,
  type Alignment,
  type NumberingFormat,
  type PaperSize,
  type StyleSetSettings,
  type StyleSetSettingsInput,
} from '@/lib/styleSets/schema'
import {
  ALIGNMENT_VALUES,
  PAPER_SIZE_TWIPS,
  findDirectChild,
  findElementSpan,
  numberingLevelXmlValues,
  parseAttributes,
} from '@/lib/styleSets/ooxml'

/**
 * Read a .docx and describe its formatting as a style set.
 *
 * This is the inverse of `applyStyleSetToPart`, deliberately written against
 * the same OOXML primitives rather than against a document-model library. The
 * reason is round-tripping: extraction has to produce settings that, applied
 * back to the document they came from, change nothing. That property is easy to
 * hold when reading and writing are two directions through one set of
 * assumptions about where a value lives, and hard to hold when a second
 * library's model has to be translated into this schema on the way through.
 *
 * **A field the document does not state comes back as `'preserve'`.** An
 * extracted style set is a description of what is there, not a filled-in form,
 * so a template that never sets its line spacing yields `'preserve'` and not a
 * guess at 1.0. That keeps "extract, then apply to the same document" a no-op.
 *
 * The one place extraction cannot be faithful is a document that is internally
 * inconsistent — three fonts across its styles, say. There is no single value
 * to report, so the dominant one wins and the rest are lost. That is inherent
 * in summarising a document as one style set, and it is why the editor shows
 * what was found rather than applying it silently.
 */

export interface ExtractedStyleSet {
  settings: StyleSetSettings
  /** What could not be summarised faithfully, for the editor to surface. */
  notes: string[]
}

export function extractStyleSetFromDocx(buffer: Buffer | Uint8Array): ExtractedStyleSet {
  let zip: PizZip
  try {
    zip = new PizZip(buffer)
  } catch {
    throw new Error('That file is not a readable .docx')
  }

  const stylesXml = readPart(zip, 'word/styles.xml')
  const numberingXml = readPart(zip, 'word/numbering.xml')
  const documentXml = readPart(zip, 'word/document.xml')

  if (documentXml === null) throw new Error('That file is not a Word document')

  const notes: string[] = []
  const input: StyleSetSettingsInput = {}

  if (stylesXml !== null) {
    input.body = extractBody(stylesXml, notes)
    input.title = extractTitle(stylesXml, notes)
  } else {
    notes.push('The document defines no styles, so no body or title formatting was read.')
  }

  if (numberingXml !== null) {
    const levels = extractLevels(numberingXml, notes)
    input.level1 = levels[0]
    input.level2 = levels[1]
    input.level3 = levels[2]
  }

  input.page = extractPage(documentXml)

  return { settings: parseStyleSetSettings(input), notes }
}

function readPart(zip: PizZip, name: string): string | null {
  const file = zip.files[name]
  if (!file || file.dir) return null
  return file.asText()
}

// ---------------------------------------------------------------------------
// Units, read back
// ---------------------------------------------------------------------------

function halfPointsToPt(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 2 : null
}

function twipsToPt(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 20 : null
}

/** OOXML booleans: absent attribute means on, `0`/`false` mean off. */
function ooxmlBoolean(span: { openTag: string } | null): boolean | null {
  if (!span) return null
  const value = parseAttributes(span.openTag)['w:val']
  if (value === undefined) return true
  return value !== '0' && value !== 'false'
}

function alignmentFromJc(value: string | undefined): Alignment | null {
  if (!value) return null
  for (const [alignment, ooxml] of Object.entries(ALIGNMENT_VALUES)) {
    if (ooxml === value) return alignment as Alignment
  }
  // `start`/`end` are the modern synonyms for left/right in newer Word files.
  if (value === 'start') return 'left'
  if (value === 'end') return 'right'
  return null
}

// ---------------------------------------------------------------------------
// Run and paragraph properties
// ---------------------------------------------------------------------------

interface RunFacts {
  fontFamily: string | null
  fontSizePt: number | null
  bold: boolean | null
}

function readRunProperties(rPrInner: string | null): RunFacts {
  if (rPrInner === null) return { fontFamily: null, fontSizePt: null, bold: null }

  const rFonts = findDirectChild(rPrInner, 'w:rFonts')
  const fontAttrs = rFonts ? parseAttributes(rFonts.openTag) : {}
  const sz = findDirectChild(rPrInner, 'w:sz')

  return {
    fontFamily: fontAttrs['w:ascii'] ?? fontAttrs['w:hAnsi'] ?? fontAttrs['w:cs'] ?? null,
    fontSizePt: halfPointsToPt(sz ? parseAttributes(sz.openTag)['w:val'] : undefined),
    bold: ooxmlBoolean(findDirectChild(rPrInner, 'w:b')),
  }
}

interface ParagraphFacts {
  alignment: Alignment | null
  spaceBeforePt: number | null
  spaceAfterPt: number | null
  lineSpacing: number | null
}

function readParagraphProperties(pPrInner: string | null): ParagraphFacts {
  if (pPrInner === null) {
    return { alignment: null, spaceBeforePt: null, spaceAfterPt: null, lineSpacing: null }
  }

  const jc = findDirectChild(pPrInner, 'w:jc')
  const spacing = findDirectChild(pPrInner, 'w:spacing')
  const spacingAttrs = spacing ? parseAttributes(spacing.openTag) : {}

  // `w:line` only means a spacing multiple under lineRule="auto"; under
  // "exact" or "atLeast" it is a fixed height, which this schema cannot say.
  const lineRule = spacingAttrs['w:lineRule']
  const line = Number(spacingAttrs['w:line'])
  const lineSpacing =
    (lineRule === 'auto' || lineRule === undefined) && Number.isFinite(line) && line > 0
      ? Number((line / 240).toFixed(3))
      : null

  return {
    alignment: alignmentFromJc(jc ? parseAttributes(jc.openTag)['w:val'] : undefined),
    spaceBeforePt: twipsToPt(spacingAttrs['w:before']),
    spaceAfterPt: twipsToPt(spacingAttrs['w:after']),
    lineSpacing,
  }
}

/** Pull a named style's `w:pPr` / `w:rPr` out of styles.xml. */
function findStyleBlocks(
  stylesXml: string,
  matches: (styleId: string, styleName: string, styleType: string, inner: string) => boolean,
): Array<{ rPr: string | null; pPr: string | null }> {
  const found: Array<{ rPr: string | null; pPr: string | null }> = []
  let cursor = 0

  for (;;) {
    const span = findElementSpan(stylesXml, 'w:style', cursor)
    if (!span) break
    cursor = span.end
    if (span.selfClosing) continue

    const attrs = parseAttributes(span.openTag)
    const nameEl = findDirectChild(span.inner, 'w:name')
    const styleName = nameEl ? (parseAttributes(nameEl.openTag)['w:val'] ?? '') : ''

    if (!matches(attrs['w:styleId'] ?? '', styleName, attrs['w:type'] ?? '', span.inner)) continue

    const rPr = findDirectChild(span.inner, 'w:rPr')
    const pPr = findDirectChild(span.inner, 'w:pPr')
    found.push({ rPr: rPr?.inner ?? null, pPr: pPr?.inner ?? null })
  }
  return found
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/**
 * Body formatting, read from `Normal` first and `docDefaults` second.
 *
 * That order matches how Word resolves it: `Normal` is what body paragraphs
 * carry, and `docDefaults` is only what they fall back to. Reading the fallback
 * first would report a document as 11pt when every paragraph in it says 12.
 */
function extractBody(stylesXml: string, notes: string[]): StyleSetSettingsInput['body'] {
  const normal = findStyleBlocks(stylesXml, styleId => styleId === 'Normal')[0] ?? null
  const defaults = findDocDefaults(stylesXml)

  const run = firstStated(readRunProperties(normal?.rPr ?? null), readRunProperties(defaults.rPr))
  const paragraph = firstStatedParagraph(
    readParagraphProperties(normal?.pPr ?? null),
    readParagraphProperties(defaults.pPr),
  )

  const fonts = distinctFonts(stylesXml)
  if (fonts.size > 1) {
    notes.push(
      `The document uses ${fonts.size} fonts (${[...fonts].slice(0, 4).join(', ')}). A style set applies one font throughout, so the others would be replaced.`,
    )
  }

  return {
    fontFamily: run.fontFamily ?? PRESERVE,
    fontSizePt: run.fontSizePt ?? PRESERVE,
    bold: run.bold ?? PRESERVE,
    alignment: paragraph.alignment ?? PRESERVE,
    spaceBeforePt: paragraph.spaceBeforePt ?? PRESERVE,
    spaceAfterPt: paragraph.spaceAfterPt ?? PRESERVE,
    lineSpacing: paragraph.lineSpacing ?? PRESERVE,
  }
}

function firstStated(primary: RunFacts, fallback: RunFacts): RunFacts {
  return {
    fontFamily: primary.fontFamily ?? fallback.fontFamily,
    fontSizePt: primary.fontSizePt ?? fallback.fontSizePt,
    bold: primary.bold ?? fallback.bold,
  }
}

function firstStatedParagraph(primary: ParagraphFacts, fallback: ParagraphFacts): ParagraphFacts {
  return {
    alignment: primary.alignment ?? fallback.alignment,
    spaceBeforePt: primary.spaceBeforePt ?? fallback.spaceBeforePt,
    spaceAfterPt: primary.spaceAfterPt ?? fallback.spaceAfterPt,
    lineSpacing: primary.lineSpacing ?? fallback.lineSpacing,
  }
}

function findDocDefaults(stylesXml: string): { rPr: string | null; pPr: string | null } {
  const defaults = findElementSpan(stylesXml, 'w:docDefaults')
  if (!defaults || defaults.selfClosing) return { rPr: null, pPr: null }

  const rPrDefault = findDirectChild(defaults.inner, 'w:rPrDefault')
  const pPrDefault = findDirectChild(defaults.inner, 'w:pPrDefault')
  return {
    rPr: rPrDefault ? (findDirectChild(rPrDefault.inner, 'w:rPr')?.inner ?? null) : null,
    pPr: pPrDefault ? (findDirectChild(pPrDefault.inner, 'w:pPr')?.inner ?? null) : null,
  }
}

/** Every distinct `w:ascii` in the part, to tell a mixed-font template apart. */
function distinctFonts(stylesXml: string): Set<string> {
  const fonts = new Set<string>()
  for (const match of stylesXml.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]+)"[^>]*\/>/g)) {
    fonts.add(match[1])
  }
  return fonts
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

/**
 * Title formatting, taken from the largest title-family style.
 *
 * Largest rather than first: this template family carries several title-ish
 * styles at different sizes, and the one worth reporting is the one a reader
 * would call the document's title.
 */
function extractTitle(stylesXml: string, notes: string[]): StyleSetSettingsInput['title'] {
  const candidates = findStyleBlocks(stylesXml, (styleId, styleName, styleType) => {
    if (styleType === 'numbering' || styleType === 'table') return false
    const haystack = `${styleId} ${styleName}`.toLowerCase()
    if (/\blist\b/.test(haystack)) return false
    return haystack.includes('title') || /\bheading\s*1\b/.test(haystack) || styleId === 'Heading1'
  })

  if (candidates.length === 0) {
    notes.push('No title style was found, so title formatting is left as the template has it.')
    return {}
  }

  const sized = candidates
    .map(block => ({ block, run: readRunProperties(block.rPr) }))
    .filter(entry => entry.run.fontSizePt !== null)
    .sort((a, b) => (b.run.fontSizePt ?? 0) - (a.run.fontSizePt ?? 0))

  const chosen = sized[0] ?? { block: candidates[0], run: readRunProperties(candidates[0].rPr) }
  const paragraph = readParagraphProperties(chosen.block.pPr)

  return {
    fontFamily: chosen.run.fontFamily ?? PRESERVE,
    fontSizePt: chosen.run.fontSizePt ?? PRESERVE,
    bold: chosen.run.bold ?? PRESERVE,
    alignment: paragraph.alignment ?? PRESERVE,
    spaceBeforePt: paragraph.spaceBeforePt ?? PRESERVE,
    spaceAfterPt: paragraph.spaceAfterPt ?? PRESERVE,
  }
}

// ---------------------------------------------------------------------------
// Numbering levels
// ---------------------------------------------------------------------------

/**
 * Recognise a numbering format from what OOXML actually wrote.
 *
 * Matched against the exact pairs this schema can produce, so a shape it has no
 * name for reports as `'preserve'` rather than being forced into the nearest
 * option. Silently rounding `1)` to `(1)` would rewrite a document's numbering
 * on the next generation for no reason the user asked for.
 */
function recogniseNumberingFormat(
  numFmt: string | undefined,
  lvlText: string | undefined,
  levelIndex: number,
): NumberingFormat | null {
  if (!numFmt || lvlText === undefined) return null
  for (const format of NUMBERING_FORMATS) {
    const expected = numberingLevelXmlValues(format, levelIndex)
    if (expected.numFmt === numFmt && expected.lvlText === lvlText) return format
  }
  return null
}

function extractLevels(
  numberingXml: string,
  notes: string[],
): [StyleSetSettingsInput['level1'], StyleSetSettingsInput['level2'], StyleSetSettingsInput['level3']] {
  // The first abstract numbering definition is the representative one. A
  // portfolio carries one per sub-document, and they are copies of each other.
  const perLevel: Array<StyleSetSettingsInput['level1']> = [{}, {}, {}]
  const seen = new Set<number>()
  let definitions = 0
  let cursor = 0

  const firstAbstract = findElementSpan(numberingXml, 'w:abstractNum')
  definitions = numberingXml.match(/<w:abstractNum\b/g)?.length ?? 0
  if (definitions > 1) {
    notes.push(
      `The document has ${definitions} numbering definitions; the first was read and the same settings would apply to all of them.`,
    )
  }
  const scope = firstAbstract && !firstAbstract.selfClosing ? firstAbstract.inner : numberingXml

  for (;;) {
    const span = findElementSpan(scope, 'w:lvl', cursor)
    if (!span) break
    cursor = span.end
    if (span.selfClosing) continue

    const ilvl = Number(parseAttributes(span.openTag)['w:ilvl'])
    if (!(ilvl >= 0 && ilvl <= 2) || seen.has(ilvl)) continue
    seen.add(ilvl)

    const numFmt = findDirectChild(span.inner, 'w:numFmt')
    const lvlText = findDirectChild(span.inner, 'w:lvlText')
    const format = recogniseNumberingFormat(
      numFmt ? parseAttributes(numFmt.openTag)['w:val'] : undefined,
      lvlText ? parseAttributes(lvlText.openTag)['w:val'] : undefined,
      ilvl,
    )

    const pPr = findDirectChild(span.inner, 'w:pPr')
    const ind = pPr ? findDirectChild(pPr.inner, 'w:ind') : null
    const indentAttrs = ind ? parseAttributes(ind.openTag) : {}
    const run = readRunProperties(findDirectChild(span.inner, 'w:rPr')?.inner ?? null)

    perLevel[ilvl] = {
      numberingFormat: format ?? PRESERVE,
      indentLeftPt: twipsToPt(indentAttrs['w:left']) ?? PRESERVE,
      hangingPt: twipsToPt(indentAttrs['w:hanging']) ?? PRESERVE,
      fontFamily: run.fontFamily ?? PRESERVE,
      fontSizePt: run.fontSizePt ?? PRESERVE,
    }
  }

  return [perLevel[0], perLevel[1], perLevel[2]]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function extractPage(documentXml: string): StyleSetSettingsInput['page'] {
  const sectPr = findElementSpan(documentXml, 'w:sectPr')
  if (!sectPr || sectPr.selfClosing) return {}

  const pgSz = findDirectChild(sectPr.inner, 'w:pgSz')
  const pgMar = findDirectChild(sectPr.inner, 'w:pgMar')
  const sizeAttrs = pgSz ? parseAttributes(pgSz.openTag) : {}
  const marginAttrs = pgMar ? parseAttributes(pgMar.openTag) : {}

  const width = Number(sizeAttrs['w:w'])
  const height = Number(sizeAttrs['w:h'])
  const landscape =
    sizeAttrs['w:orient'] === 'landscape' ||
    (Number.isFinite(width) && Number.isFinite(height) && width > height)

  // Compare in portrait so a landscape Letter page is still recognised as Letter.
  const portrait = landscape ? { width: height, height: width } : { width, height }

  return {
    paperSize: recognisePaperSize(portrait.width, portrait.height) ?? PRESERVE,
    orientation: pgSz ? (landscape ? 'landscape' : 'portrait') : PRESERVE,
    margins: {
      topPt: twipsToPt(marginAttrs['w:top']) ?? PRESERVE,
      rightPt: twipsToPt(marginAttrs['w:right']) ?? PRESERVE,
      bottomPt: twipsToPt(marginAttrs['w:bottom']) ?? PRESERVE,
      leftPt: twipsToPt(marginAttrs['w:left']) ?? PRESERVE,
    },
  }
}

/** Word rounds paper dimensions, so match within a twip or two rather than exactly. */
function recognisePaperSize(width: number, height: number): PaperSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  for (const [size, dimensions] of Object.entries(PAPER_SIZE_TWIPS)) {
    if (Math.abs(dimensions.width - width) <= 2 && Math.abs(dimensions.height - height) <= 2) {
      return size as PaperSize
    }
  }
  return null
}
