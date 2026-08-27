/**
 * The formatting the firm does by hand because a style set cannot express it.
 *
 * `lib/styleSets/defaults.ts` says as much in its own comment: pushing each
 * Article's name onto its own line, restructuring notary acknowledgment blocks,
 * and running section intros into their headings "are content edits driven by
 * reading the text — they stay manual." A style set rewrites declarative
 * properties in styles.xml; these three change what the paragraphs *are*.
 *
 * Each pass is deterministic and pure over paragraph text, so it can be tested
 * without Word. Locating and mutating paragraphs is the caller's job
 * (`formatting/runPasses.ts`), which keeps the regex judgement — the part that
 * misfires on an unusual document — separately reviewable.
 */

export type PassId = 'articleTitles' | 'notaryBlocks' | 'runInSections'

export interface ParagraphEdit {
  /** Index into the paragraph list the pass was given. */
  index: number
  before: string
  after: string
  /** Paragraph-level formatting to set alongside the text change. */
  format?: {
    alignment?: 'left' | 'centered'
    fontSizePt?: number
    leftIndentPt?: number
    spaceBeforePt?: number
    spaceAfterPt?: number
  }
  /** Paragraphs to insert immediately after this one, in order. */
  insertAfter?: Array<{ text: string; leftIndentPt?: number; spaceAfterPt?: number }>
}

export interface PassResult {
  id: PassId
  label: string
  edits: ParagraphEdit[]
}

/** "ARTICLE IV" / "Article 4" / "ARTICLE FOURTH", optionally followed by the title. */
const ARTICLE_HEADING =
  /^\s*(ARTICLE|Article)\s+([IVXLCDM]+|\d+|[A-Z][a-z]+)\s*[.:—-]?\s+(\S.*)$/

/**
 * Split "ARTICLE IV  Trustee Powers" into two lines.
 *
 * Only fires when a title actually follows the numeral — an article heading
 * that is already on its own line is left alone, which makes the pass safe to
 * run twice.
 */
export function articleTitlesPass(paragraphs: string[]): PassResult {
  const edits: ParagraphEdit[] = []

  paragraphs.forEach((text, index) => {
    const match = text.match(ARTICLE_HEADING)
    if (!match) return

    const [, word, numeral, title] = match
    // A trailing sentence is body text, not a title: articles are named, not
    // described. Bail rather than shredding a paragraph that merely opens with
    // a cross-reference like "Article IV shall govern...".
    if (/[.;]\s/.test(title) || title.length > 80) return

    edits.push({
      index,
      before: text,
      after: `${word} ${numeral}`,
      insertAfter: [{ text: title.trim() }],
    })
  })

  return { id: 'articleTitles', label: 'Article titles on their own line', edits }
}

const JURISDICTION_LINE = /^\s*(COMMONWEALTH|STATE)\s+OF\s+[A-Z][A-Za-z ]+\s*[,)]?\s*$/
const COUNTY_LINE = /^\s*(County|COUNTY)\s+OF\s+[A-Za-z ]+\s*[,)]?\s*$/i
const NOTARY_SIGNATURE = /^\s*_{5,}\s*$/

/**
 * Standardize notary acknowledgment blocks.
 *
 * A block is a jurisdiction line, a county line, then the jurat text. The firm
 * form centers the first two at 12pt, and puts "Notary Public" and
 * "My Commission Expires:" under the signature rule at a 3" indent with no
 * paragraph spacing.
 */
export function notaryBlocksPass(paragraphs: string[]): PassResult {
  const edits: ParagraphEdit[] = []

  paragraphs.forEach((text, index) => {
    if (JURISDICTION_LINE.test(text) || COUNTY_LINE.test(text)) {
      edits.push({
        index,
        before: text,
        after: text.trim(),
        format: { alignment: 'centered', fontSizePt: 12, spaceBeforePt: 0, spaceAfterPt: 0 },
      })
      return
    }

    // A signature rule inside a notary block gets the two label lines beneath
    // it — unless the document already has them, so the pass is idempotent.
    if (NOTARY_SIGNATURE.test(text) && nearNotaryBlock(paragraphs, index)) {
      const following = paragraphs.slice(index + 1, index + 3).join(' ')
      if (/Notary\s+Public/i.test(following)) return

      edits.push({
        index,
        before: text,
        after: text.trim(),
        format: { leftIndentPt: 216, spaceBeforePt: 0, spaceAfterPt: 0 },
        insertAfter: [
          { text: 'Notary Public', leftIndentPt: 216, spaceAfterPt: 0 },
          { text: 'My Commission Expires:', leftIndentPt: 216, spaceAfterPt: 0 },
        ],
      })
    }
  })

  return { id: 'notaryBlocks', label: 'Notary acknowledgment blocks', edits }
}

/** 216pt = 3 inches, the firm's notary label indent. */
function nearNotaryBlock(paragraphs: string[], index: number): boolean {
  const window = paragraphs.slice(Math.max(0, index - 8), index).join(' ')
  return /acknowledg|notary|subscribed and sworn|personally appeared/i.test(window)
}

const SECTION_HEADING = /^\s*(?:Section\s+)?(\d+(?:\.\d+)*)\s*[.:]?\s+([A-Z][^.]{2,60})\.?\s*$/

/** "(a)", "1.", "i)", "•" — the openers Word maintains as list numbering. */
const LIST_MARKER = /^(?:[•▪◦]|\(?[0-9a-zA-Z]{1,4}[.)])\s/

/**
 * Run a section's intro paragraph up into its heading.
 *
 * The firm form is a run-in heading: the section title and its period are
 * underlined, and the body text continues on the same line. That is a
 * structural change — two paragraphs become one — which is exactly why a style
 * set cannot do it.
 *
 * Underlining only the title half is applied by the caller, since it needs a
 * character range rather than paragraph text.
 */
export function runInSectionsPass(paragraphs: string[]): PassResult {
  const edits: ParagraphEdit[] = []

  paragraphs.forEach((text, index) => {
    const match = text.match(SECTION_HEADING)
    if (!match) return

    const body = paragraphs[index + 1]?.trim()
    if (!body) return
    // Only fold in real prose. A following heading, list item, or another
    // section number means this heading stands alone by design — and folding a
    // list item into its heading would wreck the list's numbering.
    if (SECTION_HEADING.test(body) || ARTICLE_HEADING.test(body)) return
    if (LIST_MARKER.test(body)) return
    if (!/^[A-Z"“(]/.test(body)) return

    const [, number, title] = match
    edits.push({
      index,
      before: text,
      after: `${number}. ${title.replace(/\.$/, '')}. ${body}`,
    })
  })

  return { id: 'runInSections', label: 'Run-in section headings', edits }
}

export const CONTENT_PASSES: Array<(paragraphs: string[]) => PassResult> = [
  articleTitlesPass,
  notaryBlocksPass,
  runInSectionsPass,
]
