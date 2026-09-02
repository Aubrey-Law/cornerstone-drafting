import {
  ALIGNMENT_VALUES,
  PAPER_SIZE_TWIPS,
  findDirectChild,
  findElementSpan,
  lineSpacingToTwentieths,
  numberingLevelXmlValues,
  parseAttributes,
  ptToHalfPoints,
  ptToTwips,
  replaceSpanInner,
  upsertEmptyChild,
  withChildContainer,
  type Attributes,
} from './ooxml'
import {
  PRESERVE,
  isOverride,
  type BodyStyle,
  type LevelStyle,
  type PageSettings,
  type StyleSetSettings,
  type TitleStyle,
} from './schema'

/**
 * Apply a style set to the parts of a rendered .docx.
 *
 * Scope, stated plainly, because the boundary is easy to misread: this changes
 * **formatting defined in styles, numbering and section properties**. It does
 * not restructure content. The firm's manual formatting passes also merge
 * paragraphs, push article names onto their own line with a vertical tab, and
 * rebuild notary blocks — all of which are decisions about *text*, made by
 * reading it. Those stay manual. What a style set retires is the typographic
 * half: the font sweep, the title size cap, the style indents, and the lettered
 * subsection level.
 *
 * Every function here is a pure string→string transform, so the whole engine is
 * testable on XML fragments without building a .docx.
 */

/** The `word/` parts a style set touches, and what it does to each. */
const RFONTS_PARTS = /^word\/(document\.xml|styles\.xml|(header|footer)\d*\.xml)$/
const RFONTS_RE = /<w:rFonts\b[^>]*\/>/g

/**
 * Style ids and names that carry a document title.
 *
 * Matching on "contains title" plus Heading 1 mirrors what the manual pass
 * looks for, and for the same reason: this template family reuses `Heading 1`
 * for document-divider titles like "Personal Property Memorandum", so skipping
 * it by name would leave those oversized.
 */
function isTitleStyle(styleId: string, styleName: string, styleType: string): boolean {
  if (styleType === 'numbering' || styleType === 'table') return false
  const haystack = `${styleId} ${styleName}`.toLowerCase()
  // "Current List 3" and friends are list-definition artifacts, never visible titles.
  if (/\blist\b/.test(haystack)) return false
  return haystack.includes('title') || /\bheading\s*1\b/.test(haystack) || styleId === 'Heading1'
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Force every run and style font to `family`.
 *
 * This is the long-standing Garamond sweep, generalised to any family and
 * otherwise unchanged — including the fact that it rewrites existing
 * `<w:rFonts/>` elements rather than adding one where none exists. Templates
 * inherit a theme default (Aptos here) and use "Times New Roman Bold" headings,
 * and the docDefaults `rFonts` that governs inheritance is itself rewritten by
 * this pass, so the inherited case is covered without touching every run.
 */
export function applyFontFamily(xml: string, family: string): string {
  return xml.replace(
    RFONTS_RE,
    `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>`,
  )
}

// ---------------------------------------------------------------------------
// Run and paragraph properties
// ---------------------------------------------------------------------------

function runPropertyAttributes(style: {
  fontSizePt: BodyStyle['fontSizePt']
  bold: BodyStyle['bold']
}): { sz?: Attributes; bold?: 'on' | 'off' } {
  const result: { sz?: Attributes; bold?: 'on' | 'off' } = {}
  if (isOverride(style.fontSizePt)) {
    const halfPoints = ptToHalfPoints(style.fontSizePt)
    // w:szCs governs complex-script runs; leaving it behind is how a document
    // ends up correct in Word and wrong in a PDF export.
    result.sz = { 'w:val': halfPoints }
  }
  if (isOverride(style.bold)) result.bold = style.bold ? 'on' : 'off'
  return result
}

function applyRunProperties(
  rPrInner: string,
  style: { fontSizePt: BodyStyle['fontSizePt']; bold: BodyStyle['bold']; fontFamily: BodyStyle['fontFamily'] },
): string {
  let inner = rPrInner
  if (isOverride(style.fontFamily)) {
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:rFonts', {
      'w:ascii': style.fontFamily,
      'w:hAnsi': style.fontFamily,
      'w:cs': style.fontFamily,
    })
  }

  const { sz, bold } = runPropertyAttributes(style)
  if (sz) {
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:sz', sz)
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:szCs', sz)
  }
  if (bold === 'on') {
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:b', { 'w:val': '1' })
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:bCs', { 'w:val': '1' })
  } else if (bold === 'off') {
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:b', { 'w:val': '0' })
    inner = upsertEmptyChild(inner, 'w:rPr', 'w:bCs', { 'w:val': '0' })
  }
  return inner
}

function applyParagraphProperties(
  pPrInner: string,
  style: {
    alignment: BodyStyle['alignment']
    spaceBeforePt: BodyStyle['spaceBeforePt']
    spaceAfterPt: BodyStyle['spaceAfterPt']
    lineSpacing?: BodyStyle['lineSpacing']
  },
): string {
  let inner = pPrInner

  // w:spacing carries before/after/line together, so build one merged patch
  // rather than three overwrites that would each drop the others.
  const spacing: Attributes = {}
  if (isOverride(style.spaceBeforePt)) spacing['w:before'] = ptToTwips(style.spaceBeforePt)
  if (isOverride(style.spaceAfterPt)) spacing['w:after'] = ptToTwips(style.spaceAfterPt)
  if (style.lineSpacing !== undefined && isOverride(style.lineSpacing)) {
    spacing['w:line'] = lineSpacingToTwentieths(style.lineSpacing)
    spacing['w:lineRule'] = 'auto'
  }
  if (Object.keys(spacing).length > 0) {
    inner = upsertEmptyChild(inner, 'w:pPr', 'w:spacing', spacing)
  }

  if (isOverride(style.alignment)) {
    inner = upsertEmptyChild(inner, 'w:pPr', 'w:jc', { 'w:val': ALIGNMENT_VALUES[style.alignment] })
  }
  return inner
}

// ---------------------------------------------------------------------------
// styles.xml
// ---------------------------------------------------------------------------

/**
 * Apply body formatting to both `docDefaults` and the `Normal` style.
 *
 * Both, because they answer different questions. `docDefaults` is what a run
 * inherits when nothing else says otherwise; `Normal` is what body paragraphs
 * actually carry. Setting only the former leaves a template that pinned a size
 * on `Normal` visibly unchanged, which reads as the feature being broken.
 */
export function applyBodyStyle(stylesXml: string, body: BodyStyle): string {
  let xml = applyDocDefaults(stylesXml, body)
  xml = withNamedStyle(xml, styleId => styleId === 'Normal', styleInner => {
    let inner = withChildContainer(styleInner, 'w:style', 'w:rPr', rPr =>
      applyRunProperties(rPr, bodyRunProperties(body)),
    )
    inner = withChildContainer(inner, 'w:style', 'w:pPr', pPr => applyParagraphProperties(pPr, body))
    return inner
  })
  return xml
}

/**
 * Body run properties minus the font family, which `applyFontFamily` owns.
 *
 * The sweep *rewrites* every `<w:rFonts/>` it finds but never adds one. Letting
 * this path set the family too would create an `rFonts` on a style that had
 * none — a change the sweep never made, and enough on its own to stop the
 * default style set being a no-op against the code it replaced.
 */
function bodyRunProperties(body: BodyStyle): BodyStyle {
  return { ...body, fontFamily: PRESERVE }
}

function applyDocDefaults(stylesXml: string, body: BodyStyle): string {
  const defaults = findElementSpan(stylesXml, 'w:docDefaults')
  if (!defaults || defaults.selfClosing) return stylesXml

  let inner = defaults.inner
  inner = withChildContainer(inner, 'w:docDefaults', 'w:rPrDefault', rPrDefault =>
    withChildContainer(rPrDefault, 'w:rPrDefault', 'w:rPr', rPr =>
      applyRunProperties(rPr, bodyRunProperties(body)),
    ),
  )
  inner = withChildContainer(inner, 'w:docDefaults', 'w:pPrDefault', pPrDefault =>
    withChildContainer(pPrDefault, 'w:pPrDefault', 'w:pPr', pPr => applyParagraphProperties(pPr, body)),
  )
  return replaceSpanInner(stylesXml, defaults, inner)
}

/**
 * Cap the title family.
 *
 * Only styles that are *currently* large are resized, matching the manual
 * pass's guard. Without it a style merely named "Subtitle Note" at 11pt gets
 * inflated to the title size, which is worse than leaving it alone.
 */
export function applyTitleStyle(stylesXml: string, title: TitleStyle): string {
  return withEveryStyle(stylesXml, (styleId, styleName, styleType, styleInner) => {
    if (!isTitleStyle(styleId, styleName, styleType)) return null
    if (isOverride(title.fontSizePt) && !isCurrentlyLargerThan(styleInner, title.fontSizePt)) {
      return null
    }
    let inner = withChildContainer(styleInner, 'w:style', 'w:rPr', rPr => applyRunProperties(rPr, title))
    inner = withChildContainer(inner, 'w:style', 'w:pPr', pPr => applyParagraphProperties(pPr, title))
    return inner
  })
}

/**
 * True when the style's own `w:sz` exceeds the target.
 *
 * A style with no explicit size inherits one, and is treated as a candidate:
 * that is the "Heading 1 reused as a divider title" case, which carries its
 * size through the heading chain rather than directly.
 */
function isCurrentlyLargerThan(styleInner: string, targetPt: number): boolean {
  const rPr = findDirectChild(styleInner, 'w:rPr')
  if (!rPr) return true
  const sz = findDirectChild(rPr.inner, 'w:sz')
  if (!sz) return true
  const value = Number(parseAttributes(sz.openTag)['w:val'])
  if (!Number.isFinite(value)) return true
  return value > ptToHalfPoints(targetPt)
}

type StyleVisitor = (
  styleId: string,
  styleName: string,
  styleType: string,
  styleInner: string,
) => string | null

/** Walk every `<w:style>`, replacing the inner content the visitor returns. */
function withEveryStyle(stylesXml: string, visit: StyleVisitor): string {
  let xml = stylesXml
  let cursor = 0

  for (;;) {
    const span = findElementSpan(xml, 'w:style', cursor)
    if (!span) break
    if (span.selfClosing) {
      cursor = span.end
      continue
    }

    const attrs = parseAttributes(span.openTag)
    const styleId = attrs['w:styleId'] ?? ''
    const styleType = attrs['w:type'] ?? ''
    const nameEl = findDirectChild(span.inner, 'w:name')
    const styleName = nameEl ? (parseAttributes(nameEl.openTag)['w:val'] ?? '') : ''

    const updated = visit(styleId, styleName, styleType, span.inner)
    if (updated === null) {
      cursor = span.end
      continue
    }

    xml = replaceSpanInner(xml, span, updated)
    // The replacement changes length, so resume from the recomputed end rather
    // than the stale one.
    cursor = span.start + span.openTag.length + updated.length + '</w:style>'.length
  }
  return xml
}

function withNamedStyle(
  stylesXml: string,
  matches: (styleId: string, styleName: string) => boolean,
  transform: (styleInner: string) => string,
): string {
  return withEveryStyle(stylesXml, (styleId, styleName, _type, inner) =>
    matches(styleId, styleName) ? transform(inner) : null,
  )
}

// ---------------------------------------------------------------------------
// numbering.xml
// ---------------------------------------------------------------------------

/**
 * Apply level formatting to every abstract numbering definition in the part.
 *
 * Every definition, not one: a portfolio-style document carries a separate list
 * instance per sub-document, and the manual pass explicitly loops "each distinct
 * list" for the same reason. Fixing only the first leaves the will formatted and
 * the trust not.
 */
export function applyNumberingLevels(
  numberingXml: string,
  levels: { level1: LevelStyle; level2: LevelStyle; level3: LevelStyle },
  numberingEnabled: StyleSetSettings['numbering']['enabled'],
): string {
  const byIndex: Record<number, LevelStyle> = { 0: levels.level1, 1: levels.level2, 2: levels.level3 }
  let xml = numberingXml
  let cursor = 0

  for (;;) {
    const span = findElementSpan(xml, 'w:lvl', cursor)
    if (!span || span.selfClosing) {
      if (!span) break
      cursor = span.end
      continue
    }

    const ilvl = Number(parseAttributes(span.openTag)['w:ilvl'])
    const level = byIndex[ilvl]
    if (!level) {
      cursor = span.end
      continue
    }

    const updated = applyOneLevel(span.inner, level, ilvl, numberingEnabled)
    xml = replaceSpanInner(xml, span, updated)
    cursor = span.start + span.openTag.length + updated.length + '</w:lvl>'.length
  }
  return xml
}

function applyOneLevel(
  lvlInner: string,
  level: LevelStyle,
  levelIndex: number,
  numberingEnabled: StyleSetSettings['numbering']['enabled'],
): string {
  let inner = lvlInner

  if (isOverride(numberingEnabled) && !numberingEnabled) {
    // "none" is how OOXML says a level renders no number at all; removing the
    // element instead would fall back to the default decimal.
    inner = upsertEmptyChild(inner, 'w:lvl', 'w:numFmt', { 'w:val': 'none' })
    inner = upsertEmptyChild(inner, 'w:lvl', 'w:lvlText', { 'w:val': '' })
  } else if (isOverride(level.numberingFormat)) {
    const { numFmt, lvlText } = numberingLevelXmlValues(level.numberingFormat, levelIndex)
    inner = upsertEmptyChild(inner, 'w:lvl', 'w:numFmt', { 'w:val': numFmt })
    inner = upsertEmptyChild(inner, 'w:lvl', 'w:lvlText', { 'w:val': lvlText })
  }

  const indent: Attributes = {}
  if (isOverride(level.indentLeftPt)) indent['w:left'] = ptToTwips(level.indentLeftPt)
  if (isOverride(level.hangingPt)) {
    // A zero hanging indent must clear any firstLine the template set, or the
    // number and its text end up on different left edges.
    indent['w:hanging'] = ptToTwips(level.hangingPt)
  }
  if (Object.keys(indent).length > 0) {
    inner = withChildContainer(inner, 'w:lvl', 'w:pPr', pPr => {
      const updated = upsertEmptyChild(pPr, 'w:pPr', 'w:ind', indent)
      // `w:hanging` and `w:firstLine` are mutually exclusive — they are the same
      // measurement in opposite directions. Whenever the style set states a
      // hanging indent, a `w:firstLine` the template left behind has to go, or
      // Word picks one and the level lands at an indent nobody asked for.
      return 'w:hanging' in indent ? dropAttribute(updated, 'w:ind', 'w:firstLine') : updated
    })
  }

  if (isOverride(level.fontFamily) || isOverride(level.fontSizePt)) {
    inner = withChildContainer(inner, 'w:lvl', 'w:rPr', rPr =>
      applyRunProperties(rPr, {
        fontFamily: level.fontFamily,
        fontSizePt: level.fontSizePt,
        bold: 'preserve',
      }),
    )
  }

  return inner
}

// ---------------------------------------------------------------------------
// document.xml — page setup
// ---------------------------------------------------------------------------

/**
 * Apply paper size, orientation and margins to every section in the document.
 *
 * Landscape is two facts in OOXML, not one: the `w:orient` attribute *and*
 * swapped width/height. Word honours the dimensions and treats `w:orient` as a
 * hint, so setting only the attribute produces a page that claims to be
 * landscape and prints portrait.
 */
export function applyPageSetup(documentXml: string, page: PageSettings): string {
  const wantsSize = isOverride(page.paperSize) || isOverride(page.orientation)
  const margins = marginAttributes(page)
  if (!wantsSize && Object.keys(margins).length === 0) return documentXml

  let xml = documentXml
  let cursor = 0

  for (;;) {
    const span = findElementSpan(xml, 'w:sectPr', cursor)
    if (!span) break
    if (span.selfClosing) {
      cursor = span.end
      continue
    }

    let inner = span.inner
    if (wantsSize) inner = upsertEmptyChild(inner, 'w:sectPr', 'w:pgSz', pageSizeAttributes(inner, page))
    if (Object.keys(margins).length > 0) {
      inner = upsertEmptyChild(inner, 'w:sectPr', 'w:pgMar', margins)
    }

    xml = replaceSpanInner(xml, span, inner)
    cursor = span.start + span.openTag.length + inner.length + '</w:sectPr>'.length
  }
  return xml
}

function pageSizeAttributes(sectPrInner: string, page: PageSettings): Attributes {
  const existing = findDirectChild(sectPrInner, 'w:pgSz')
  const current = existing ? parseAttributes(existing.openTag) : {}

  const currentOrientation = current['w:orient'] === 'landscape' ? 'landscape' : 'portrait'
  const orientation = isOverride(page.orientation) ? page.orientation : currentOrientation

  let width = Number(current['w:w'])
  let height = Number(current['w:h'])
  if (isOverride(page.paperSize)) {
    const size = PAPER_SIZE_TWIPS[page.paperSize]
    width = size.width
    height = size.height
  } else if (Number.isFinite(width) && Number.isFinite(height)) {
    // Normalise to portrait so the swap below is applied from a known footing
    // rather than doubled when the template was already landscape.
    if (currentOrientation === 'landscape') [width, height] = [height, width]
  } else {
    const size = PAPER_SIZE_TWIPS.letter
    width = size.width
    height = size.height
  }

  const attrs: Attributes = orientation === 'landscape'
    ? { 'w:w': height, 'w:h': width, 'w:orient': 'landscape' }
    : { 'w:w': width, 'w:h': height }

  // A page that goes back to portrait must lose the attribute, not carry a
  // stale `w:orient="landscape"` beside portrait dimensions.
  if (orientation === 'portrait' && current['w:orient']) attrs['w:orient'] = 'portrait'
  return attrs
}

function marginAttributes(page: PageSettings): Attributes {
  const attrs: Attributes = {}
  const { margins } = page
  if (isOverride(margins.topPt)) attrs['w:top'] = ptToTwips(margins.topPt)
  if (isOverride(margins.rightPt)) attrs['w:right'] = ptToTwips(margins.rightPt)
  if (isOverride(margins.bottomPt)) attrs['w:bottom'] = ptToTwips(margins.bottomPt)
  if (isOverride(margins.leftPt)) attrs['w:left'] = ptToTwips(margins.leftPt)
  return attrs
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Transform one `word/` part according to the style set.
 *
 * Returns the XML unchanged for parts the style set has nothing to say about,
 * so callers can hand it every part in the archive without filtering first.
 */
export function applyStyleSetToPart(
  partName: string,
  xml: string,
  settings: StyleSetSettings,
): string {
  let result = xml

  if (isOverride(settings.body.fontFamily) && RFONTS_PARTS.test(partName)) {
    result = applyFontFamily(result, settings.body.fontFamily)
  }

  if (partName === 'word/styles.xml') {
    result = applyBodyStyle(result, settings.body)
    result = applyTitleStyle(result, settings.title)
  }

  if (partName === 'word/numbering.xml') {
    result = applyNumberingLevels(
      result,
      { level1: settings.level1, level2: settings.level2, level3: settings.level3 },
      settings.numbering.enabled,
    )
  }

  if (partName === 'word/document.xml') {
    result = applyPageSetup(result, settings.page)
  }

  return result
}

/** Exported for the test that pins the part list the applier claims to touch. */
export const STYLE_SET_PART_PATTERN = RFONTS_PARTS

/** Remove one attribute from an empty child element, leaving the rest intact. */
function dropAttribute(parentInner: string, childTag: string, attribute: string): string {
  const child = findDirectChild(parentInner, childTag)
  if (!child) return parentInner
  const attrs = parseAttributes(child.openTag)
  if (!(attribute in attrs)) return parentInner
  delete attrs[attribute]
  const rebuilt = `<${childTag}${Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')}/>`
  return parentInner.slice(0, child.start) + rebuilt + parentInner.slice(child.end)
}
