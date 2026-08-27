import type { Alignment, NumberingFormat, Orientation, PaperSize } from '@/lib/styleSets/schema'

/**
 * OOXML primitives for applying a style set to an existing .docx.
 *
 * Two things about WordprocessingML drive the shape of this module:
 *
 * **1. Children are schema-ordered, not free-form.** `<w:rPr>` must list
 * `w:rFonts` before `w:b` before `w:sz`; `<w:pPr>` must list `w:spacing` before
 * `w:ind` before `w:jc`. Word will refuse to open a file that gets this wrong,
 * and the failure is a flat "unreadable content" dialog with no hint at the
 * cause. So `upsertEmptyChild` never appends — it looks the tag up in the
 * canonical order below and splices it into the right slot.
 *
 * **2. Everything is measured in twentieths.** Font sizes are half-points,
 * indents and margins are twips (1/20 pt), line spacing is 240ths of a line.
 * The conversions live here so callers above can stay in points.
 *
 * The functions edit XML as text rather than parsing and rebuilding it. That is
 * deliberate: a parse/rebuild round-trip through fast-xml-parser reorders
 * attributes and normalises self-closing tags across the whole part, producing a
 * huge diff for a two-attribute change and risking exactly the kind of breakage
 * described above in parts this module never meant to touch.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Points → half-points, the unit of `w:sz`. */
export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2)
}

/** Points → twips, the unit of `w:ind`, `w:spacing` and `w:pgMar`. */
export function ptToTwips(pt: number): number {
  return Math.round(pt * 20)
}

/** Inches → twips, for paper sizes quoted in inches. */
export function inchesToTwips(inches: number): number {
  return Math.round(inches * 1440)
}

/**
 * A line-spacing multiple → the value of `w:line` under `w:lineRule="auto"`,
 * which counts 240ths of a line. Single spacing is 240, double is 480.
 */
export function lineSpacingToTwentieths(multiple: number): number {
  return Math.round(multiple * 240)
}

/** Page dimensions in twips, portrait. */
export const PAPER_SIZE_TWIPS: Record<PaperSize, { width: number; height: number }> = {
  letter: { width: 12240, height: 15840 },
  legal: { width: 12240, height: 20160 },
  a4: { width: 11906, height: 16838 },
}

export const ALIGNMENT_VALUES: Record<Alignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * A numbering format at a given level, as OOXML expresses it: a digit style
 * (`w:numFmt`) plus the text around it (`w:lvlText`), where `%N` interpolates
 * the counter for level N.
 *
 * `hierarchicalDecimal` is the only format that reads its ancestors: level 3
 * renders `1.2.3`, so its `lvlText` names every counter above it. The rest are
 * self-contained, which is what lets a lettered `(a)` level restart under each
 * new section without carrying the section number along.
 */
export function numberingLevelXmlValues(
  format: NumberingFormat,
  levelIndex: number,
): { numFmt: string; lvlText: string } {
  const counter = `%${levelIndex + 1}`
  switch (format) {
    case 'hierarchicalDecimal': {
      const chain = Array.from({ length: levelIndex + 1 }, (_, i) => `%${i + 1}`).join('.')
      // Word's own multilevel list writes a trailing period at the top level
      // only ("1." then "1.1"), and matching it keeps generated documents
      // indistinguishable from hand-built ones.
      return { numFmt: 'decimal', lvlText: levelIndex === 0 ? `${chain}.` : chain }
    }
    case 'lowerLetterParenthetical':
      return { numFmt: 'lowerLetter', lvlText: `(${counter})` }
    case 'lowerRomanParenthetical':
      return { numFmt: 'lowerRoman', lvlText: `(${counter})` }
    case 'upperLetterParenthetical':
      return { numFmt: 'upperLetter', lvlText: `(${counter})` }
    case 'upperRoman':
      return { numFmt: 'upperRoman', lvlText: `${counter}.` }
  }
}

// ---------------------------------------------------------------------------
// Canonical child ordering
// ---------------------------------------------------------------------------

/** CT_RPr, trimmed to the run properties this module writes or steps over. */
const RPR_ORDER = [
  'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps',
  'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint',
  'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing',
  'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
  'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang',
]

/** CT_PPr, same treatment. */
const PPR_ORDER = [
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr',
  'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs',
  'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct',
  'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd',
  'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents',
  'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment',
  'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr',
]

/** CT_Lvl, the children of a `<w:lvl>` in numbering.xml. */
const LVL_ORDER = [
  'w:start', 'w:numFmt', 'w:lvlRestart', 'w:pStyle', 'w:isLgl', 'w:suff', 'w:lvlText',
  'w:lvlPicBulletId', 'w:legacy', 'w:lvlJc', 'w:pPr', 'w:rPr',
]

/** CT_SectPr, enough of it to place `w:pgSz` and `w:pgMar`. */
const SECTPR_ORDER = [
  'w:footnotePr', 'w:endnotePr', 'w:type', 'w:pgSz', 'w:pgMar', 'w:paperSrc',
  'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols', 'w:formProt', 'w:vAlign',
  'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid',
]

const CHILD_ORDERS: Record<string, string[]> = {
  'w:rPr': RPR_ORDER,
  'w:pPr': PPR_ORDER,
  'w:lvl': LVL_ORDER,
  'w:sectPr': SECTPR_ORDER,
}

// ---------------------------------------------------------------------------
// Element scanning
// ---------------------------------------------------------------------------

export interface ElementSpan {
  /** Index of the `<` that opens the element. */
  start: number
  /** Index just past the element's final `>`. */
  end: number
  /** Content between the open and close tags; empty for a self-closing tag. */
  inner: string
  /** The open tag itself, e.g. `<w:style w:styleId="Title">`. */
  openTag: string
  selfClosing: boolean
}

/**
 * Locate one element by tag name, counting nesting so that a `<w:rPr>` inside a
 * nested `<w:pPr>` does not terminate the outer scan.
 *
 * Returns null rather than throwing when the tag is absent — most callers here
 * treat "the template never had one" as a normal case to insert into.
 */
export function findElementSpan(xml: string, tag: string, from = 0): ElementSpan | null {
  const openRe = new RegExp(`<${escapeTag(tag)}(\\s[^>]*?)?(/)?>`, 'g')
  openRe.lastIndex = from
  const opening = openRe.exec(xml)
  if (!opening) return null

  const start = opening.index
  const openTag = opening[0]
  if (opening[2] === '/') {
    return { start, end: start + openTag.length, inner: '', openTag, selfClosing: true }
  }

  // Walk forward balancing same-name opens and closes.
  const scanRe = new RegExp(`<(/)?${escapeTag(tag)}(\\s[^>]*?)?(/)?>`, 'g')
  scanRe.lastIndex = start + openTag.length
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = scanRe.exec(xml))) {
    if (match[1]) {
      depth -= 1
      if (depth === 0) {
        const end = match.index + match[0].length
        return {
          start,
          end,
          inner: xml.slice(start + openTag.length, match.index),
          openTag,
          selfClosing: false,
        }
      }
    } else if (!match[3]) {
      depth += 1
    }
  }
  return null
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace an element's inner content, leaving its open tag untouched. */
export function replaceSpanInner(xml: string, span: ElementSpan, inner: string): string {
  const closeTag = `</${span.openTag.slice(1).split(/[\s/>]/)[0]}>`
  return xml.slice(0, span.start) + span.openTag + inner + closeTag + xml.slice(span.end)
}

// ---------------------------------------------------------------------------
// Attribute and child editing
// ---------------------------------------------------------------------------

export type Attributes = Record<string, string | number>

function renderAttributes(attrs: Attributes): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttributeValue(String(value))}"`)
    .join('')
}

function escapeAttributeValue(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Set attributes on an empty child element inside `parentInner`, creating the
 * child at its schema-mandated position if it is absent and merging with any
 * attributes already there if it is present.
 *
 * Merging rather than replacing matters: `<w:spacing>` carries `w:before`,
 * `w:after`, `w:line` and `w:lineRule` together, and a style set that overrides
 * only the line spacing must not wipe the template's paragraph spacing on the
 * way past.
 */
export function upsertEmptyChild(
  parentInner: string,
  parentTag: string,
  childTag: string,
  attrs: Attributes,
): string {
  const existing = findDirectChild(parentInner, childTag)
  if (existing) {
    const merged = { ...parseAttributes(existing.openTag), ...attrs }
    const replacement = `<${childTag}${renderAttributes(merged)}/>`
    return parentInner.slice(0, existing.start) + replacement + parentInner.slice(existing.end)
  }

  const element = `<${childTag}${renderAttributes(attrs)}/>`
  const at = insertionIndexFor(parentInner, parentTag, childTag)
  return parentInner.slice(0, at) + element + parentInner.slice(at)
}

/** Remove an empty child element if present. */
export function removeChild(parentInner: string, childTag: string): string {
  const existing = findDirectChild(parentInner, childTag)
  if (!existing) return parentInner
  return parentInner.slice(0, existing.start) + parentInner.slice(existing.end)
}

/**
 * Find a child at the top level of `parentInner` only.
 *
 * The depth tracking is not pedantry. `<w:pPr>` and `<w:rPr>` both have a
 * `<w:spacing>` child meaning entirely different things — paragraph spacing in
 * one, inter-character spacing in the other — and a paragraph's `w:pPr` can
 * contain a `w:rPr` describing the paragraph mark. A first-match scan would
 * happily write a paragraph's "space after" into its pilcrow's letter spacing.
 */
export function findDirectChild(parentInner: string, childTag: string): ElementSpan | null {
  const tagRe = /<(\/)?([\w:.-]+)(?:\s[^>]*?)?(\/)?>/g
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(parentInner))) {
    const [full, closing, name, selfClosing] = match
    if (closing) {
      depth -= 1
      continue
    }
    if (depth === 0 && name === childTag) {
      if (selfClosing) {
        return { start: match.index, end: match.index + full.length, inner: '', openTag: full, selfClosing: true }
      }
      return findElementSpan(parentInner, childTag, match.index)
    }
    if (!selfClosing) depth += 1
  }
  return null
}

export function parseAttributes(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of openTag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

/**
 * Where a new child belongs: immediately before the first existing child that
 * outranks it in the canonical order. Unknown parents append, which is correct
 * for the sequence-free containers this module touches.
 */
function insertionIndexFor(parentInner: string, parentTag: string, childTag: string): number {
  const order = CHILD_ORDERS[parentTag]
  if (!order) return parentInner.length

  const rank = order.indexOf(childTag)
  if (rank === -1) return parentInner.length

  // Only siblings count, so descend past nested elements rather than ranking
  // their children against this parent's schema.
  const tagRe = /<(\/)?([\w:.-]+)(?:\s[^>]*?)?(\/)?>/g
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(parentInner))) {
    const [, closing, name, selfClosing] = match
    if (closing) {
      depth -= 1
      continue
    }
    if (depth === 0 && order.indexOf(name) > rank) return match.index
    if (!selfClosing) depth += 1
  }
  return parentInner.length
}

/**
 * Ensure a container element exists inside `parentInner` and hand its content to
 * `transform`. Used for `<w:rPr>` / `<w:pPr>` blocks that a lean template may
 * simply not have written.
 */
export function withChildContainer(
  parentInner: string,
  parentTag: string,
  containerTag: string,
  transform: (inner: string) => string,
): string {
  const existing = findDirectChild(parentInner, containerTag)
  if (existing && !existing.selfClosing) {
    const updated = transform(existing.inner)
    return (
      parentInner.slice(0, existing.start) +
      existing.openTag +
      updated +
      `</${containerTag}>` +
      parentInner.slice(existing.end)
    )
  }

  // A transform with nothing to say must not leave an empty `<w:rPr></w:rPr>`
  // behind. Callers run this over every style in the part, so creating on no
  // change would litter the whole file and break the guarantee that a fully
  // preserved style set is a byte-for-byte no-op.
  const content = transform('')
  if (content === '') return parentInner

  const created = `<${containerTag}>${content}</${containerTag}>`
  if (existing?.selfClosing) {
    return parentInner.slice(0, existing.start) + created + parentInner.slice(existing.end)
  }
  const at = insertionIndexFor(parentInner, parentTag, containerTag)
  return parentInner.slice(0, at) + created + parentInner.slice(at)
}

export const ORIENTATION_ATTRIBUTE: Record<Orientation, string> = {
  portrait: 'portrait',
  landscape: 'landscape',
}
