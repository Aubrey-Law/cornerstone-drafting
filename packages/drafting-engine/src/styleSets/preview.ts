import {
  PRESERVE,
  isNoOpStyleSet,
  isOverride,
  type NumberingFormat,
  type StyleSetSettings,
} from './schema'
import { PAPER_SIZE_TWIPS, numberingLevelXmlValues } from './ooxml'

/**
 * A style set, turned into something that can be drawn on screen.
 *
 * **What this preview is, stated plainly, because the alternative is a lie.**
 * It is a browser rendering CSS from the settings — not Word rendering OOXML.
 * Page proportions, relative type sizes, indents, spacing and numbering shapes
 * are faithful; hyphenation, justification, kerning, widow control and exact
 * line breaks are not. It answers "is this the layout I meant" and not "is this
 * the page my client receives".
 *
 * **`'preserve'` is the harder half.** A preserved field means the template's
 * own value wins, and the preview does not have the template — so it cannot
 * show the truth about that field, and inventing a plausible value would make
 * the page look authoritative exactly where it knows least. Instead every
 * preserved property falls back to a neutral, documented baseline and is
 * *reported* as preserved, so the page distinguishes what the style set decides
 * from what it leaves alone.
 */

/**
 * Stand-in values for anything the style set preserves.
 *
 * Chosen to look obviously generic rather than to imitate the firm's templates:
 * a preview that quietly resembles the real output where it is actually
 * guessing is worse than one that visibly does not.
 */
export const PREVIEW_BASELINE = {
  fontFamily: 'Georgia, serif',
  fontSizePt: 11,
  bold: false,
  alignment: 'left' as const,
  lineSpacing: 1.15,
  spaceBeforePt: 0,
  spaceAfterPt: 8,
  titleFontSizePt: 18,
  titleBold: true,
  titleAlignment: 'center' as const,
  indentLeftPt: 0,
  hangingPt: 18,
  paperSize: 'letter' as const,
  orientation: 'portrait' as const,
  marginPt: 72,
} as const

/** CSS-ready values for one block of text, plus which of them were guessed. */
export interface PreviewBlock {
  fontFamily: string
  fontSizePt: number
  bold: boolean
  textAlign: string
  lineHeight: number
  spaceBeforePt: number
  spaceAfterPt: number
  /** Property names shown from the baseline because the style set preserves them. */
  preserved: string[]
}

export interface PreviewLevel extends PreviewBlock {
  /** The number as it would render, e.g. `(a)` or `1.1`. */
  marker: string
  indentLeftPt: number
  hangingPt: number
  /** True when the style set switches numbering off entirely. */
  unnumbered: boolean
}

export interface PreviewPage {
  widthIn: number
  heightIn: number
  marginTopPt: number
  marginRightPt: number
  marginBottomPt: number
  marginLeftPt: number
  preserved: string[]
}

export interface StyleSetPreview {
  page: PreviewPage
  body: PreviewBlock
  title: PreviewBlock
  levels: PreviewLevel[]
  /** Every property drawn from the baseline rather than from the style set. */
  preservedProperties: string[]
  /** True when the style set decides nothing, so the whole page is baseline. */
  isEntirelyPreserved: boolean
}

const TWIPS_PER_INCH = 1440

function resolve<T>(
  value: T | typeof PRESERVE,
  fallback: T,
  name: string,
  preserved: string[],
): T {
  if (isOverride(value)) return value
  preserved.push(name)
  return fallback
}

function buildBlock(
  source: {
    fontFamily: StyleSetSettings['body']['fontFamily']
    fontSizePt: StyleSetSettings['body']['fontSizePt']
    bold: StyleSetSettings['body']['bold']
    alignment: StyleSetSettings['body']['alignment']
    spaceBeforePt: StyleSetSettings['body']['spaceBeforePt']
    spaceAfterPt: StyleSetSettings['body']['spaceAfterPt']
    lineSpacing?: StyleSetSettings['body']['lineSpacing']
  },
  fallbacks: { fontSizePt: number; bold: boolean; alignment: 'left' | 'center' | 'right' | 'justify' },
  prefix: string,
): PreviewBlock {
  const preserved: string[] = []
  const alignment = resolve(source.alignment, fallbacks.alignment, `${prefix} alignment`, preserved)

  return {
    fontFamily: resolve(source.fontFamily, PREVIEW_BASELINE.fontFamily, `${prefix} font`, preserved),
    fontSizePt: resolve(source.fontSizePt, fallbacks.fontSizePt, `${prefix} size`, preserved),
    bold: resolve(source.bold, fallbacks.bold, `${prefix} weight`, preserved),
    // The schema's alignment names are already CSS names. OOXML's spelling of
    // justify ("both") is the applier's business, not the preview's.
    textAlign: alignment,
    lineHeight:
      source.lineSpacing === undefined
        ? PREVIEW_BASELINE.lineSpacing
        : resolve(source.lineSpacing, PREVIEW_BASELINE.lineSpacing, `${prefix} line spacing`, preserved),
    spaceBeforePt: resolve(source.spaceBeforePt, PREVIEW_BASELINE.spaceBeforePt, `${prefix} space before`, preserved),
    spaceAfterPt: resolve(source.spaceAfterPt, PREVIEW_BASELINE.spaceAfterPt, `${prefix} space after`, preserved),
    preserved,
  }
}

/**
 * The counter for a level, rendered the way its format would render it.
 *
 * Always the first item — `1`, `a`, `i` — because the preview is showing the
 * *shape* of the numbering, and a sample starting at 1 is the one a reader can
 * check against their own expectation without doing arithmetic.
 */
function formatCounter(numFmt: string): string {
  switch (numFmt) {
    case 'lowerLetter':
      return 'a'
    case 'upperLetter':
      return 'A'
    case 'lowerRoman':
      return 'i'
    case 'upperRoman':
      return 'I'
    default:
      return '1'
  }
}

/**
 * Render a level's numbering as text, e.g. `(a)` or `1.1.1`.
 *
 * Ancestor counters in a hierarchical format are always decimal — that is what
 * makes it hierarchical decimal — so only the level's own format varies.
 */
export function sampleMarker(format: NumberingFormat, levelIndex: number): string {
  const { numFmt, lvlText } = numberingLevelXmlValues(format, levelIndex)
  return lvlText.replace(/%(\d)/g, (_, position: string) =>
    Number(position) === levelIndex + 1 ? formatCounter(numFmt) : '1',
  )
}

function buildLevel(
  level: StyleSetSettings['level1'],
  levelIndex: number,
  numberingEnabled: StyleSetSettings['numbering']['enabled'],
  body: PreviewBlock,
): PreviewLevel {
  const preserved: string[] = []
  const name = `Level ${levelIndex + 1}`
  const unnumbered = isOverride(numberingEnabled) && !numberingEnabled

  let marker = ''
  if (!unnumbered) {
    if (isOverride(level.numberingFormat)) {
      marker = sampleMarker(level.numberingFormat, levelIndex)
    } else {
      preserved.push(`${name} numbering`)
      marker = sampleMarker('hierarchicalDecimal', levelIndex)
    }
  }

  return {
    marker,
    indentLeftPt: resolve(level.indentLeftPt, PREVIEW_BASELINE.indentLeftPt, `${name} indent`, preserved),
    hangingPt: resolve(level.hangingPt, PREVIEW_BASELINE.hangingPt, `${name} hanging`, preserved),
    // A level inherits the body's type unless it says otherwise, which is what
    // Word does and what stops the preview implying five different fonts.
    fontFamily: resolve(level.fontFamily, body.fontFamily, `${name} font`, preserved),
    fontSizePt: resolve(level.fontSizePt, body.fontSizePt, `${name} size`, preserved),
    bold: false,
    textAlign: body.textAlign,
    lineHeight: body.lineHeight,
    spaceBeforePt: body.spaceBeforePt,
    spaceAfterPt: body.spaceAfterPt,
    unnumbered,
    preserved,
  }
}

function buildPage(page: StyleSetSettings['page']): PreviewPage {
  const preserved: string[] = []
  const paperSize = resolve(page.paperSize, PREVIEW_BASELINE.paperSize, 'Paper size', preserved)
  const orientation = resolve(page.orientation, PREVIEW_BASELINE.orientation, 'Orientation', preserved)

  const portrait = PAPER_SIZE_TWIPS[paperSize]
  const widthIn = (orientation === 'landscape' ? portrait.height : portrait.width) / TWIPS_PER_INCH
  const heightIn = (orientation === 'landscape' ? portrait.width : portrait.height) / TWIPS_PER_INCH

  return {
    widthIn,
    heightIn,
    marginTopPt: resolve(page.margins.topPt, PREVIEW_BASELINE.marginPt, 'Top margin', preserved),
    marginRightPt: resolve(page.margins.rightPt, PREVIEW_BASELINE.marginPt, 'Right margin', preserved),
    marginBottomPt: resolve(page.margins.bottomPt, PREVIEW_BASELINE.marginPt, 'Bottom margin', preserved),
    marginLeftPt: resolve(page.margins.leftPt, PREVIEW_BASELINE.marginPt, 'Left margin', preserved),
    preserved,
  }
}

export function buildStyleSetPreview(settings: StyleSetSettings): StyleSetPreview {
  const body = buildBlock(
    settings.body,
    {
      fontSizePt: PREVIEW_BASELINE.fontSizePt,
      bold: PREVIEW_BASELINE.bold,
      alignment: PREVIEW_BASELINE.alignment,
    },
    'Body',
  )

  const title = buildBlock(
    { ...settings.title, lineSpacing: undefined },
    {
      fontSizePt: PREVIEW_BASELINE.titleFontSizePt,
      bold: PREVIEW_BASELINE.titleBold,
      alignment: PREVIEW_BASELINE.titleAlignment,
    },
    'Title',
  )
  // A title with no font of its own follows the body, as it would in Word.
  if (!isOverride(settings.title.fontFamily) && isOverride(settings.body.fontFamily)) {
    title.fontFamily = body.fontFamily
    title.preserved = title.preserved.filter(name => name !== 'Title font')
  }

  const page = buildPage(settings.page)
  const levels = [settings.level1, settings.level2, settings.level3].map((level, index) =>
    buildLevel(level, index, settings.numbering.enabled, body),
  )

  const preservedProperties = [
    ...page.preserved,
    ...title.preserved,
    ...body.preserved,
    ...levels.flatMap(level => level.preserved),
  ]

  return {
    page,
    body,
    title,
    levels,
    preservedProperties,
    isEntirelyPreserved: isNoOpStyleSet(settings),
  }
}

/** The sample text the preview lays out. Fixed, so edits change only formatting. */
export const PREVIEW_CONTENT = {
  title: 'Revocable Trust Agreement',
  opening:
    'This Trust Agreement is made this day between the Grantor and the Trustee, who agree that the property listed in Schedule A shall be held, administered, and distributed on the terms set out below.',
  levels: [
    'Trusteeship. The Grantor appoints the Trustee named above to serve, and appoints the Successor Trustee to serve if the Trustee is unable or unwilling to act.',
    'Resignation. A Trustee may resign at any time by giving thirty days written notice to the Grantor, or after the Grantor’s death, to each then-current beneficiary.',
    'The resigning Trustee shall deliver all trust property and records to the successor within a reasonable time.',
  ],
  closing:
    'The Grantor reserves the right to amend or revoke this Agreement in whole or in part at any time during the Grantor’s lifetime.',
} as const
