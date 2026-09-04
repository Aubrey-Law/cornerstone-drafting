import { createHash } from 'node:crypto'
// The specific module, not the package barrel. The barrel re-exports the whole
// generator, so importing it here dragged nunjucks, pizzip and the template
// renderer into the review route's bundle for the sake of one paragraph
// extractor. This module needs only jszip and fast-xml-parser.
import { extractDocxParagraphs } from '@aubrey-law/drafting-engine/docxTrackedChanges'
import type { TextBlock, TextLayer } from './types'

export const DOCX_EXTRACTOR = 'docx-accepted-view'
export const DOCX_EXTRACTOR_VERSION = '1'

/** Separator between paragraphs in the canonical text. Fixed — offsets depend on it. */
const PARAGRAPH_SEPARATOR = '\n\n'

/**
 * Builds a text layer over a DOCX's accepted-view text.
 *
 * The one design decision worth stating: **a block is a paragraph, and its
 * index is that paragraph's index in the document.** That makes the trip from a
 * citation back to an edit exact rather than approximate — `blockIndex` is the
 * `paragraphIndex` `applyTrackedEditsAtOffsets` expects, and subtracting the
 * block's `charStart` gives the offsets within it. No searching, no alignment,
 * nothing to get subtly wrong between finding a problem and marking it up.
 *
 * "Accepted view" means pending insertions are included and pending deletions
 * are not — the text as a reviewer sees it, which is the text a finding should
 * be about.
 *
 * A DOCX has no page concept in its markup; page numbers are the layout
 * engine's business and are simply not knowable here. `page` is null and
 * citations read as `¶ 47`.
 */
export async function buildDocxTextLayer(bytes: Buffer): Promise<TextLayer> {
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
  const paragraphs = await extractDocxParagraphs(bytes)

  const blocks: TextBlock[] = []
  let text = ''

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) text += PARAGRAPH_SEPARATOR
    const charStart = text.length
    text += paragraph
    blocks.push({
      index,
      charStart,
      charEnd: text.length,
      text: paragraph,
      page: null,
      bbox: null,
    })
  })

  // Empty paragraphs are kept rather than filtered, because dropping one would
  // shift every later block index away from the paragraph index it has to match.
  return {
    sourceKind: 'docx',
    status: text.trim().length === 0 ? 'no_text' : 'ok',
    extractor: DOCX_EXTRACTOR,
    extractorVersion: DOCX_EXTRACTOR_VERSION,
    sourceSha256,
    pageCount: null,
    text,
    blocks,
    spans: [],
  }
}

/**
 * Converts a verified citation into offsets within its paragraph.
 *
 * Returns null when the citation does not sit inside a single block. A finding
 * spanning a paragraph boundary is a real thing a model can produce, and the
 * honest response is to decline to redline it rather than mark up an arbitrary
 * part of it.
 */
export function citationToParagraphOffsets(
  layer: TextLayer,
  charStart: number,
  charEnd: number,
): { paragraphIndex: number; start: number; end: number } | null {
  const block = layer.blocks.find(b => charStart >= b.charStart && charEnd <= b.charEnd)
  if (!block) return null
  return {
    paragraphIndex: block.index,
    start: charStart - block.charStart,
    end: charEnd - block.charStart,
  }
}
