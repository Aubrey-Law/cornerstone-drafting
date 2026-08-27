import { parseStyleSetSettings, type StyleSetSettings } from '@/lib/styleSets/schema'

/**
 * The style sets that ship with the app.
 *
 * There are two, and the distinction between them is the whole safety argument
 * for turning this on:
 *
 * - `LEGACY_GARAMOND_STYLE_SET` is **exactly what the generator did before
 *   style sets existed** — the Garamond font sweep, nothing else. It is the
 *   default, so introducing this engine changes no generated document.
 * - `AUBREY_HOUSE_STYLE_SET` is the firm's actual written house style, taken
 *   from the formatting passes that are run by hand today. It is opt-in,
 *   because it *does* change output, and that change should be somebody's
 *   deliberate decision made while looking at a preview.
 */

/**
 * The pre-style-set behaviour, expressed as a style set.
 *
 * Every field other than the font family is `'preserve'`, which is what makes
 * this equivalent to the old `normalizeFontsToGaramond()` rather than merely
 * similar to it. A test pins that equivalence.
 */
export const LEGACY_GARAMOND_STYLE_SET: StyleSetSettings = parseStyleSetSettings({
  body: { fontFamily: 'Garamond' },
})

/**
 * Aubrey Law's house formatting, as the manual passes describe it.
 *
 * Sourced from the three formatting-pass procedures: Garamond throughout, every
 * document title capped at 14pt, and the lettered `(a)`/`(b)` subsection level
 * aligned at 0.25" with no hanging indent so the letter and its text share a
 * left edge.
 *
 * What is deliberately **not** here, because a style set cannot express it:
 * pushing each Article's name onto its own line, restructuring notary
 * acknowledgment blocks, and running section intros into their headings. Those
 * are content edits driven by reading the text — they stay manual, and calling
 * this style set a replacement for all three passes would overstate it.
 */
export const AUBREY_HOUSE_STYLE_SET: StyleSetSettings = parseStyleSetSettings({
  body: { fontFamily: 'Garamond' },
  title: { fontSizePt: 14 },
  level3: {
    // 18pt = 0.25 inch. Hanging zero puts the "(a)" and its text at the same
    // left edge, which is the visible difference from Word's default list.
    indentLeftPt: 18,
    hangingPt: 0,
    fontFamily: 'Garamond',
  },
})

export const BUILT_IN_STYLE_SETS = {
  legacyGaramond: LEGACY_GARAMOND_STYLE_SET,
  aubreyHouse: AUBREY_HOUSE_STYLE_SET,
} as const

export type BuiltInStyleSetId = keyof typeof BUILT_IN_STYLE_SETS

/**
 * The style set applied when a caller names none.
 *
 * Deliberately the legacy one. Changing this constant changes every document
 * the firm generates, so it should move only alongside a decision to adopt the
 * house style wholesale.
 */
export const DEFAULT_STYLE_SET: StyleSetSettings = LEGACY_GARAMOND_STYLE_SET
