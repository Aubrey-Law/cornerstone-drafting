import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildPdfTextLayer } from '@/lib/textLayer/pdf'
import type { TextLayer } from '@/lib/textLayer/types'

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/text-layer')

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name))
}

let cached: TextLayer | null = null
async function trustLayer(): Promise<TextLayer> {
  cached ??= await buildPdfTextLayer(fixture('trust-excerpt.pdf'))
  return cached
}

describe('PDF text layer', () => {
  /**
   * The invariant every citation depends on. If a block's recorded offsets stop
   * addressing its own text, then so does every citation ever written against
   * this document — and nothing else in the pipeline would notice.
   */
  it('addresses its own blocks by offset', async () => {
    const layer = await trustLayer()
    expect(layer.blocks.length).toBeGreaterThan(0)
    for (const block of layer.blocks) {
      expect(layer.text.slice(block.charStart, block.charEnd)).toBe(block.text)
    }
  })

  it('addresses its own spans by offset', async () => {
    const layer = await trustLayer()
    for (const span of layer.spans) {
      expect(span.charEnd).toBeGreaterThan(span.charStart)
      expect(layer.text.slice(span.charStart, span.charEnd).trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps blocks in reading order and non-overlapping', async () => {
    const layer = await trustLayer()
    for (let i = 1; i < layer.blocks.length; i += 1) {
      expect(layer.blocks[i].charStart).toBeGreaterThanOrEqual(layer.blocks[i - 1].charEnd)
      expect(layer.blocks[i].index).toBe(i)
    }
  })

  /**
   * A heading and the paragraph under it are separate citable units. An earlier
   * cut took the median line gap as normal spacing, which on a short page lands
   * on a paragraph gap and welds the two together.
   */
  it('separates a heading from the paragraph beneath it', async () => {
    const layer = await trustLayer()
    const heading = layer.blocks.find(b => b.text.startsWith('ARTICLE VIII'))
    expect(heading).toBeDefined()
    expect(heading?.text).toBe('ARTICLE VIII. DISTRIBUTIONS')
  })

  it('joins the lines of one paragraph into a single block', async () => {
    const layer = await trustLayer()
    const indemnity = layer.blocks.find(b => b.text.startsWith('The Settlor shall indemnify'))
    expect(indemnity?.text).toContain('willful misconduct')
  })

  it('records pages and top-left-origin geometry', async () => {
    const layer = await trustLayer()
    expect(layer.pageCount).toBe(2)
    expect(new Set(layer.blocks.map(b => b.page))).toEqual(new Set([1, 2]))

    // First line of page one sits at y=720 on a 792pt page, drawn at 12pt.
    const first = layer.blocks[0]
    expect(first.bbox).not.toBeNull()
    expect(first.bbox?.y).toBeCloseTo(792 - (720 + 12), 5)
    expect(first.bbox?.x).toBeCloseTo(72, 5)
  })

  /**
   * Re-extraction has to be reproducible or every stored offset becomes a claim
   * about a document that no longer parses the same way.
   */
  it('is deterministic across extractions', async () => {
    const a = await buildPdfTextLayer(fixture('trust-excerpt.pdf'))
    const b = await buildPdfTextLayer(fixture('trust-excerpt.pdf'))
    expect(b.sourceSha256).toBe(a.sourceSha256)
    expect(b.text).toBe(a.text)
    expect(b.blocks).toEqual(a.blocks)
    expect(b.spans).toEqual(a.spans)
  })

  it('does not consume the caller’s buffer', async () => {
    const bytes = fixture('trust-excerpt.pdf')
    await buildPdfTextLayer(bytes)
    expect(bytes.length).toBeGreaterThan(0)
    const again = await buildPdfTextLayer(bytes)
    expect(again.text.length).toBeGreaterThan(0)
  })

  /**
   * A scan has to announce itself. An empty layer reported as healthy reads
   * downstream as a document with nothing wrong in it, which is the worst
   * possible answer to give about a document nobody has read.
   */
  it('reports a scanned page as having no text layer', async () => {
    const layer = await buildPdfTextLayer(fixture('scanned.pdf'))
    expect(layer.status).toBe('no_text')
  })

  it('records the extractor and its version for staleness checks', async () => {
    const layer = await trustLayer()
    expect(layer.extractor).toBe('pdfjs')
    expect(layer.extractorVersion).toBeTruthy()
    expect(layer.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
