import { z } from 'zod'

/**
 * A style set is a firm's document formatting, stored once instead of applied by
 * hand on every draft.
 *
 * The design turns on one idea: **`'preserve'` is a real value, not a missing
 * one.** Every override in here can say "leave whatever the template already
 * had". That matters because this firm's Word templates are not blank — they
 * carry formatting somebody chose deliberately, and a style set that silently
 * imposed a default on every unset field would flatten it. So the schema
 * distinguishes three states, and only the third touches the document:
 *
 *   - `'preserve'` — the template's own value wins.
 *   - an explicit value — override the template.
 *   - (nothing else; there is no "unset". Parsing fills every field.)
 *
 * The practical consequence is that a style set which is `'preserve'` all the
 * way down is a guaranteed no-op, which is what makes it safe to run this on
 * every generated document from day one.
 *
 * Units are the ones a person would say out loud — points and inches — not
 * OOXML's half-points and twips. The conversion happens at the edge, in
 * `applyStyleSet`, so nothing above this line has to think in twentieths.
 */

export const PRESERVE = 'preserve'
export type Preserve = typeof PRESERVE

/** Wraps any schema so that the literal string `'preserve'` is also accepted. */
function preservable<T extends z.ZodTypeAny>(inner: T) {
  return z.union([z.literal(PRESERVE), inner])
}

export type Preservable<T> = T | Preserve

/** True when a field carries a real override rather than "leave it alone". */
export function isOverride<T>(value: Preservable<T>): value is T {
  return value !== PRESERVE
}

export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

export const PAPER_SIZES = ['letter', 'legal', 'a4'] as const
export type PaperSize = (typeof PAPER_SIZES)[number]

export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type Orientation = (typeof ORIENTATIONS)[number]

/**
 * The numbering shapes an estate document actually uses. Deliberately a closed
 * list rather than raw OOXML `w:numFmt` values: the parenthetical forms are a
 * *pair* of decisions (the digit style and the surrounding punctuation), and
 * letting those drift apart is how a document ends up with `(a)` at one level
 * and `b.` at the next.
 */
export const NUMBERING_FORMATS = [
  'hierarchicalDecimal',
  'lowerLetterParenthetical',
  'lowerRomanParenthetical',
  'upperLetterParenthetical',
  'upperRoman',
] as const
export type NumberingFormat = (typeof NUMBERING_FORMATS)[number]

const fontSizePt = z.number().min(1).max(400)
const pointOffset = z.number().min(-2000).max(2000)
const nonNegativePoints = z.number().min(0).max(2000)

const runFormattingShape = {
  fontFamily: preservable(z.string().min(1).max(120)),
  fontSizePt: preservable(fontSizePt),
  bold: preservable(z.boolean()),
}

const paragraphSpacingShape = {
  alignment: preservable(z.enum(ALIGNMENTS)),
  spaceBeforePt: preservable(nonNegativePoints),
  spaceAfterPt: preservable(nonNegativePoints),
}

export const bodyStyleSchema = z.object({
  ...runFormattingShape,
  ...paragraphSpacingShape,
  /** Multiple of single spacing: 1 = single, 1.5, 2 = double. */
  lineSpacing: preservable(z.number().min(0.25).max(10)),
})

export const titleStyleSchema = z.object({
  ...runFormattingShape,
  ...paragraphSpacingShape,
})

export const levelStyleSchema = z.object({
  numberingFormat: preservable(z.enum(NUMBERING_FORMATS)),
  /** Distance from the left margin to the text, in points (72pt = 1 inch). */
  indentLeftPt: preservable(pointOffset),
  /**
   * How far the number hangs to the *left* of the text. Zero means the number
   * and the text start at the same position — which is what the lettered
   * `(a)` subsection level wants, and is not the Word default.
   */
  hangingPt: preservable(nonNegativePoints),
  fontFamily: preservable(z.string().min(1).max(120)),
  fontSizePt: preservable(fontSizePt),
})

export const pageMarginsSchema = z.object({
  topPt: preservable(nonNegativePoints),
  rightPt: preservable(nonNegativePoints),
  bottomPt: preservable(nonNegativePoints),
  leftPt: preservable(nonNegativePoints),
})

export const pageSchema = z.object({
  paperSize: preservable(z.enum(PAPER_SIZES)),
  orientation: preservable(z.enum(ORIENTATIONS)),
  margins: pageMarginsSchema,
})

export const styleSetSettingsSchema = z.object({
  body: bodyStyleSchema,
  title: titleStyleSchema,
  level1: levelStyleSchema,
  level2: levelStyleSchema,
  level3: levelStyleSchema,
  numbering: z.object({
    /**
     * `false` strips list numbering from the levels below. Distinct from
     * `'preserve'` on a level's `numberingFormat`, which keeps whatever
     * numbering the template already had.
     */
    enabled: preservable(z.boolean()),
  }),
  page: pageSchema,
})

export type StyleSetSettings = z.infer<typeof styleSetSettingsSchema>
export type BodyStyle = z.infer<typeof bodyStyleSchema>
export type TitleStyle = z.infer<typeof titleStyleSchema>
export type LevelStyle = z.infer<typeof levelStyleSchema>
export type PageSettings = z.infer<typeof pageSchema>

/**
 * A style set that changes nothing. Every other style set is this one with
 * specific fields overridden, which is why `parseStyleSetSettings` merges onto
 * it rather than requiring callers to spell out all twenty-odd fields.
 */
export const PRESERVE_ALL_SETTINGS: StyleSetSettings = {
  body: {
    fontFamily: PRESERVE,
    fontSizePt: PRESERVE,
    bold: PRESERVE,
    alignment: PRESERVE,
    spaceBeforePt: PRESERVE,
    spaceAfterPt: PRESERVE,
    lineSpacing: PRESERVE,
  },
  title: {
    fontFamily: PRESERVE,
    fontSizePt: PRESERVE,
    bold: PRESERVE,
    alignment: PRESERVE,
    spaceBeforePt: PRESERVE,
    spaceAfterPt: PRESERVE,
  },
  level1: emptyLevel(),
  level2: emptyLevel(),
  level3: emptyLevel(),
  numbering: { enabled: PRESERVE },
  page: {
    paperSize: PRESERVE,
    orientation: PRESERVE,
    margins: { topPt: PRESERVE, rightPt: PRESERVE, bottomPt: PRESERVE, leftPt: PRESERVE },
  },
}

function emptyLevel(): LevelStyle {
  return {
    numberingFormat: PRESERVE,
    indentLeftPt: PRESERVE,
    hangingPt: PRESERVE,
    fontFamily: PRESERVE,
    fontSizePt: PRESERVE,
  }
}

/** A style set as it arrives from storage or a form: any subset of the fields. */
export type StyleSetSettingsInput = {
  body?: Partial<BodyStyle>
  title?: Partial<TitleStyle>
  level1?: Partial<LevelStyle>
  level2?: Partial<LevelStyle>
  level3?: Partial<LevelStyle>
  numbering?: { enabled?: Preservable<boolean> }
  page?: {
    paperSize?: Preservable<PaperSize>
    orientation?: Preservable<Orientation>
    margins?: Partial<PageSettings['margins']>
  }
}

/**
 * Fill a partial style set out to a complete one, treating every absent field as
 * `'preserve'`, then validate.
 *
 * Absent and `'preserve'` collapse to the same thing here *on purpose*: stored
 * settings are a jsonb blob that will gain fields over time, and a document
 * generated against an older blob must keep rendering rather than fail
 * validation on a key that did not exist when it was saved. Adding a field to
 * this schema is therefore always backward-compatible.
 *
 * Throws on a field that is present but malformed — a `fontSizePt` of `-4` is a
 * bug worth surfacing, not a value worth guessing at.
 */
export function parseStyleSetSettings(input: unknown): StyleSetSettings {
  const raw = (input ?? {}) as StyleSetSettingsInput
  return styleSetSettingsSchema.parse({
    body: { ...PRESERVE_ALL_SETTINGS.body, ...raw.body },
    title: { ...PRESERVE_ALL_SETTINGS.title, ...raw.title },
    level1: { ...PRESERVE_ALL_SETTINGS.level1, ...raw.level1 },
    level2: { ...PRESERVE_ALL_SETTINGS.level2, ...raw.level2 },
    level3: { ...PRESERVE_ALL_SETTINGS.level3, ...raw.level3 },
    numbering: { ...PRESERVE_ALL_SETTINGS.numbering, ...raw.numbering },
    page: {
      ...PRESERVE_ALL_SETTINGS.page,
      ...raw.page,
      margins: { ...PRESERVE_ALL_SETTINGS.page.margins, ...raw.page?.margins },
    },
  })
}

/** True when applying this style set cannot change any document. */
export function isNoOpStyleSet(settings: StyleSetSettings): boolean {
  return !containsOverride(settings)
}

function containsOverride(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsOverride)
  if (value && typeof value === 'object') return Object.values(value).some(containsOverride)
  return value !== PRESERVE
}
