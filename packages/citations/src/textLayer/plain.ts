import { createHash } from 'node:crypto'
import type { TextBlock, TextLayer } from './types'

/** Must match docx.ts, so a citation's offsets read the same way from either. */
const PARAGRAPH_SEPARATOR = '\n\n'

export const PLAIN_EXTRACTOR = 'word-paragraphs'
export const PLAIN_EXTRACTOR_VERSION = '1'

/**
 * A text layer built from paragraph strings the caller already has — in
 * practice, `Word.Paragraph.text` for every paragraph of the document open in
 * the Word add-in.
 *
 * Built from Word's own paragraphs rather than from the file, for one reason:
 * a finding has to be found again in Word, and Word can only find text by
 * searching. Text read from the same paragraphs Word will later search is the
 * text that search will match, and a block's index is the paragraph's index in
 * `body.paragraphs` — so the pane can go straight to the right paragraph and
 * search inside it, instead of searching the whole document for a phrase that
 * may occur more than once.
 *
 * Empty paragraphs are kept, as in `buildDocxTextLayer`: dropping one would
 * shift every later block index off the paragraph it names.
 */
export function buildPlainTextLayer(paragraphs: string[]): TextLayer {
  const blocks: TextBlock[] = []
  let text = ''

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) text += PARAGRAPH_SEPARATOR
    const charStart = text.length
    text += paragraph
    blocks.push({ index, charStart, charEnd: text.length, text: paragraph, page: null, bbox: null })
  })

  return {
    sourceKind: 'plain',
    status: text.trim().length === 0 ? 'no_text' : 'ok',
    extractor: PLAIN_EXTRACTOR,
    extractorVersion: PLAIN_EXTRACTOR_VERSION,
    sourceSha256: createHash('sha256').update(text).digest('hex'),
    pageCount: null,
    text,
    blocks,
    spans: [],
  }
}
