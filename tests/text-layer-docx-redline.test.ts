import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { applyTrackedEditsAtOffsets, extractDocxParagraphs } from '@aubrey-law/drafting-engine'
import { extractTrackedChangeIds, resolveTrackedChange } from '@/lib/docxTrackedChanges'
import { buildDocxTextLayer, citationToParagraphOffsets } from '@/lib/textLayer/docx'
import { verifyQuote } from '@/lib/textLayer/match'

const PARAGRAPHS = [
  'ARTICLE VII. TRUSTEE POWERS',
  'The Settlor shall indemnify and hold harmless the Trustee from and against any and all claims arising out of the administration of this trust, except for claims arising from the Trustee willful misconduct.',
  'No bond or other security shall be required of any Trustee named herein, whether original or successor, in any jurisdiction.',
  // Two occurrences of the same phrase in one paragraph: the case a fuzzy
  // locator cannot resolve and offsets settle outright.
  'The Trustee shall consider other resources, and in making distributions the Trustee shall act in good faith.',
]

async function trustDocx(paragraphs: string[] = PARAGRAPHS): Promise<Buffer> {
  const zip = new JSZip()
  const body = paragraphs
    .map(text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

async function documentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  return zip.file('word/document.xml')!.async('string')
}

describe('DOCX text layer', () => {
  it('addresses its own blocks by offset', async () => {
    const layer = await buildDocxTextLayer(await trustDocx())
    for (const block of layer.blocks) {
      expect(layer.text.slice(block.charStart, block.charEnd)).toBe(block.text)
    }
  })

  /**
   * The property the redline path depends on. If block index ever stops being
   * paragraph index, every exported edit lands in the wrong paragraph — and
   * would still produce a valid-looking DOCX.
   */
  it('numbers blocks by paragraph index', async () => {
    const layer = await buildDocxTextLayer(await trustDocx())
    expect(layer.blocks).toHaveLength(PARAGRAPHS.length)
    layer.blocks.forEach((block, index) => {
      expect(block.index).toBe(index)
      expect(block.text).toBe(PARAGRAPHS[index])
    })
  })

  it('keeps empty paragraphs so indexes stay aligned', async () => {
    const layer = await buildDocxTextLayer(await trustDocx(['First', '', 'Third']))
    expect(layer.blocks.map(b => b.text)).toEqual(['First', '', 'Third'])
    expect(layer.blocks[2].index).toBe(2)
  })

  it('has no page numbers, because a DOCX does not have any', async () => {
    const layer = await buildDocxTextLayer(await trustDocx())
    expect(layer.pageCount).toBeNull()
    expect(layer.blocks.every(b => b.page === null)).toBe(true)
  })
})

describe('citation to tracked-change round trip', () => {
  /**
   * The acceptance test for the export half of the slice: a quote the model
   * produced, verified against the document, becomes a tracked change whose
   * deletion is exactly the cited text — no searching anywhere in between.
   */
  it('marks up exactly the text a citation names', async () => {
    const bytes = await trustDocx()
    const layer = await buildDocxTextLayer(bytes)

    const verified = verifyQuote(layer, 'except for claims arising from the Trustee willful misconduct', 1)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return

    const offsets = citationToParagraphOffsets(layer, verified.citation.charStart, verified.citation.charEnd)
    expect(offsets).not.toBeNull()
    expect(offsets?.paragraphIndex).toBe(1)

    const applied = await applyTrackedEditsAtOffsets(bytes, [
      {
        paragraphIndex: offsets!.paragraphIndex,
        start: offsets!.start,
        end: offsets!.end,
        replace: 'except to the extent such claims arise from the Trustee’s own willful misconduct, bad faith, or gross negligence',
        reason: 'Indemnity carve-out is narrower than the firm position',
      },
    ])

    expect(applied.errors).toEqual([])
    expect(applied.changes).toHaveLength(1)
    expect(applied.changes[0].deletedText).toContain('willful misconduct')

    const xml = await documentXml(applied.bytes)
    expect(xml).toContain('<w:ins')
    expect(xml).toContain('<w:del')
    expect(xml).toContain('gross negligence')
  })

  /**
   * "the Trustee shall" occurs twice in the paragraph. The block-scoped
   * verifier refuses it — correctly, since it cannot know which one is meant —
   * while a citation carrying real offsets marks up the second occurrence and
   * leaves the first alone.
   */
  it('reaches the second occurrence of a repeated phrase', async () => {
    const bytes = await trustDocx()
    const layer = await buildDocxTextLayer(bytes)

    expect(verifyQuote(layer, 'the Trustee shall', 3).ok).toBe(false)

    const paragraph = layer.blocks[3].text
    const start = paragraph.lastIndexOf('the Trustee shall')
    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { paragraphIndex: 3, start, end: start + 'the Trustee shall'.length, replace: 'the Trustee must' },
    ])

    expect(applied.errors).toEqual([])

    // Read the result back in accepted view: the second occurrence changed and
    // the first is untouched, which no assertion over raw XML states as plainly.
    const after = await extractDocxParagraphs(applied.bytes)
    expect(after[3]).toBe(
      'The Trustee shall consider other resources, and in making distributions the Trustee must act in good faith.',
    )
  })

  /**
   * Applying forward would invalidate every offset after the first edit. Two
   * edits in one paragraph is the cheapest case that catches it, and it is the
   * kind of bug that produces a plausible-looking document rather than an error.
   */
  it('applies several edits in one paragraph without shifting the later offsets', async () => {
    const bytes = await trustDocx()
    const layer = await buildDocxTextLayer(bytes)
    const paragraph = layer.blocks[2].text

    const bondAt = paragraph.indexOf('No bond')
    const jurisdictionAt = paragraph.indexOf('in any jurisdiction')

    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { paragraphIndex: 2, start: bondAt, end: bondAt + 'No bond'.length, replace: 'No surety bond' },
      {
        paragraphIndex: 2,
        start: jurisdictionAt,
        end: jurisdictionAt + 'in any jurisdiction'.length,
        replace: 'in any jurisdiction whatsoever',
      },
    ])

    expect(applied.errors).toEqual([])
    expect(applied.changes).toHaveLength(2)
    const after = await extractDocxParagraphs(applied.bytes)
    expect(after[2]).toBe(
      'No surety bond or other security shall be required of any Trustee named herein, whether original or successor, in any jurisdiction whatsoever.',
    )
  })

  it('reports results in the order the caller passed them', async () => {
    const bytes = await trustDocx()
    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { paragraphIndex: 2, start: 0, end: 7, replace: 'No surety bond' },
      { paragraphIndex: 1, start: 0, end: 10, replace: 'The Grantor' },
    ])
    expect(applied.errors).toEqual([])
    // Applying runs bottom-up so offsets stay valid; reporting must not.
    expect(applied.changes[0].insertedText).toContain('surety')
    expect(applied.changes[1].insertedText).toContain('Grantor')
  })

  /**
   * The strongest available proxy for "open it in Word and check".
   *
   * Rejecting every change has to restore the original exactly. It exercises
   * the same accept/reject machinery `DocxViewerPanel` runs against
   * `document_edits`, so passing here means the export lands in the review UI
   * that already ships rather than in a document Word will quietly repair.
   */
  it('produces changes the existing accept/reject path round-trips', async () => {
    const bytes = await trustDocx()
    const layer = await buildDocxTextLayer(bytes)

    const verified = verifyQuote(layer, 'No bond or other security shall be required', 2)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    const offsets = citationToParagraphOffsets(layer, verified.citation.charStart, verified.citation.charEnd)!

    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { ...offsets, replace: 'No surety bond shall be required', reason: 'Rule 2' },
    ])
    expect(applied.errors).toEqual([])

    const ids = await extractTrackedChangeIds(applied.bytes)
    expect(ids.length).toBeGreaterThan(0)

    const accepted = await resolveTrackedChange(applied.bytes, ids.map(i => i.w_id), 'accept')
    expect((await extractDocxParagraphs(accepted.bytes))[2]).toContain('No surety bond shall be required')

    const rejected = await resolveTrackedChange(applied.bytes, ids.map(i => i.w_id), 'reject')
    expect(await extractDocxParagraphs(rejected.bytes)).toEqual(PARAGRAPHS)
  })

  it('refuses overlapping edits rather than silently picking one', async () => {
    const bytes = await trustDocx()
    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { paragraphIndex: 2, start: 0, end: 20, replace: 'A' },
      { paragraphIndex: 2, start: 10, end: 30, replace: 'B' },
    ])
    expect(applied.changes).toHaveLength(1)
    expect(applied.errors).toHaveLength(1)
    expect(applied.errors[0].reason).toContain('overlap')
  })

  it('refuses offsets outside the paragraph', async () => {
    const bytes = await trustDocx()
    const applied = await applyTrackedEditsAtOffsets(bytes, [
      { paragraphIndex: 2, start: 0, end: 100_000, replace: 'x' },
      { paragraphIndex: 99, start: 0, end: 1, replace: 'y' },
    ])
    expect(applied.changes).toEqual([])
    expect(applied.errors.map(e => e.index).sort()).toEqual([0, 1])
  })
})
