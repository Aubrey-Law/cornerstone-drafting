import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib'

/**
 * The face a typed signature is stamped in.
 *
 * Someone who types their name instead of drawing it still needs the result to
 * read as a signature rather than as a word inserted into the sentence. #498
 * moved it from Helvetica to italic serif as a stopgap and said so in the code:
 * a real script face needs an embedded font, and that is this module.
 *
 * `assets/fonts/NothingYouCouldDo-Regular.ttf` — SIL OFL 1.1, Kimberly Geswein,
 * licence vendored beside it. A casual handwriting face rather than a formal
 * calligraphic one, which is what a signature actually looks like.
 */

const FONT_FILE = 'assets/fonts/NothingYouCouldDo-Regular.ttf'

/**
 * Times italic's cap height, per em, from its AFM metrics (CapHeight 653 on a
 * 1000-unit em).
 *
 * The script face is *bigger* on the same nominal size, not smaller as a script
 * face usually is: measured, its cap height is 0.740 em against Times italic's
 * 0.653, while its x-height is almost identical (0.451 against 0.441). What
 * makes it read as handwriting is the ascenders and descenders — 1.334 em of
 * total vertical extent against 0.900 — not larger letters.
 *
 * So the nominal size is scaled to hold the *cap height* where it already was.
 * That keeps the letter size Scott has already seen and approved, changes only
 * the letterforms, and leaves the overhang that makes it look signed.
 */
const TIMES_ITALIC_CAP_PER_EM = 653 / 1000

export interface SignatureFace {
  font: PDFFont
  /**
   * Multiplier for the nominal point size, so that whichever face is in use
   * puts its capitals at the same height on the signature line.
   */
  sizeScale: number
}

/**
 * Embed the script face, falling back to what shipped before it.
 *
 * Deliberately degrades rather than throwing, the same way
 * `standardFontDataPath()` in packages/citations/src/textLayer/pdf.ts does, and
 * for the same reason stated there: losing a font must not take down a
 * signature run. A missing, unreadable or corrupt file must never be why a
 * client cannot sign their engagement agreement — the fallback is exactly the
 * face that is in production today, so the worst case is the status quo.
 */
export async function embedSignatureFont(doc: PDFDocument): Promise<SignatureFace> {
  try {
    // A literal path, not a constant assembled elsewhere: @vercel/nft evaluates
    // these statically and traces the file into the serverless bundle.
    // next.config.mjs names it under /api/sign/[token] as well, because that
    // static-analysis guarantee disappears the moment the string moves.
    const bytes = await readFile(path.join(process.cwd(), FONT_FILE))

    // fontkit's own public API, rather than reaching into pdf-lib's embedder
    // for the same numbers.
    const metrics = fontkit.create(bytes)
    const capPerEm = metrics.capHeight / metrics.unitsPerEm

    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(bytes, { subset: true })

    return {
      font,
      // A font reporting no usable cap height gets left alone rather than
      // scaled by a nonsense ratio.
      sizeScale: capPerEm > 0 ? TIMES_ITALIC_CAP_PER_EM / capPerEm : 1,
    }
  } catch (error) {
    console.warn(
      '[esign] Could not embed %s, so typed signatures fall back to italic serif. '
        + 'The file should be vendored in the repo and traced into this route by '
        + "next.config.mjs's outputFileTracingIncludes. Cause: %s",
      FONT_FILE,
      error instanceof Error ? error.message : String(error),
    )
    return { font: await doc.embedFont(StandardFonts.TimesRomanItalic), sizeScale: 1 }
  }
}
