import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { bboxesForRange, verifyQuote } from '@/lib/textLayer/match'
import { buildPdfTextLayer } from '@/lib/textLayer/pdf'
import type { TextLayer } from '@/lib/textLayer/types'

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/text-layer')

let cached: TextLayer | null = null
async function trustLayer(): Promise<TextLayer> {
  cached ??= await buildPdfTextLayer(fs.readFileSync(path.join(FIXTURES, 'trust-excerpt.pdf')))
  return cached
}

async function blockStarting(prefix: string): Promise<number> {
  const layer = await trustLayer()
  const block = layer.blocks.find(b => b.text.startsWith(prefix))
  if (!block) throw new Error(`fixture has no block starting "${prefix}"`)
  return block.index
}

describe('citation verification', () => {
  /**
   * The acceptance test for the whole citation model: what comes back has to
   * address the document it claims to address, character for character.
   */
  it('returns offsets that slice back to the quote', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(layer, 'No bond or other security shall be required', await blockStarting('No bond'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(layer.text.slice(result.citation.charStart, result.citation.charEnd)).toBe(result.citation.quote)
    expect(result.citation.verification).toBe('verified')
    expect(result.citation.page).toBe(1)
  })

  /**
   * The model repeats a quote as running prose; the document has it broken
   * across two drawn lines. Matching has to survive that, because otherwise
   * every quote longer than a line fails and the product is unusable.
   */
  it('matches a quote spanning a line break inside a paragraph', async () => {
    const layer = await trustLayer()
    const quote =
      'The Settlor shall indemnify and hold harmless the Trustee from and against any and all claims'
    const result = verifyQuote(layer, quote, await blockStarting('The Settlor'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sliced = layer.text.slice(result.citation.charStart, result.citation.charEnd)
    expect(sliced).toContain('any and')
    expect(sliced).toContain('all claims')
    expect(sliced.replace(/\s+/g, ' ')).toBe(quote)
  })

  it('tolerates case, curly quotes and doubled spacing in the model’s string', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(
      layer,
      'no  BOND or other security  shall be required',
      await blockStarting('No bond'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // What is stored is the document's text, not the model's rendition of it.
    expect(result.citation.quote.startsWith('No bond')).toBe(true)
  })

  /**
   * A hallucinated quote must produce nothing. This is the case that decides
   * whether a finding can be trusted at all.
   */
  it('refuses a quote that is not in the document', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(layer, 'The Trustee shall post a surety bond in all events', 3)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not_found')
  })

  /**
   * "the Trustee shall" appears in several paragraphs of the fixture, on
   * purpose. Returning the first hit would be a coin flip dressed up as a
   * citation.
   */
  it('refuses a quote that appears more than once', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(layer, 'the Trustee shall', null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('ambiguous')
    expect(result.matches).toBeGreaterThan(1)
  })

  it('refuses an empty or whitespace-only quote', async () => {
    const layer = await trustLayer()
    expect(verifyQuote(layer, '', 0).ok).toBe(false)
    expect(verifyQuote(layer, '   \n  ', 0).ok).toBe(false)
  })

  it('refuses everything when there is no text layer', async () => {
    const scanned = await buildPdfTextLayer(
      fs.readFileSync(path.join(FIXTURES, 'scanned.pdf')),
    )
    const result = verifyQuote(scanned, 'anything at all', 0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_text_layer')
  })

  /**
   * A wrong hint should not lose a citation that genuinely exists — but the
   * uniqueness rule widens with the search, so this can only ever recover a
   * quote occurring exactly once in the whole instrument.
   */
  it('recovers from a wrong block hint, and says it widened', async () => {
    const layer = await trustLayer()
    const wrongHint = await blockStarting('ARTICLE VII.')
    const result = verifyQuote(layer, 'per stirpes', wrongHint)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scope).toBe('document')
    expect(result.citation.page).toBe(2)
  })

  it('scopes a repeated phrase by block hint when the block disambiguates it', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(layer, 'the Trustee shall', await blockStarting('In the exercise'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scope).toBe('block')
    expect(result.citation.blockIndex).toBe(await blockStarting('In the exercise'))
  })

  it('yields drawing rectangles that stay inside the page', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(layer, 'per stirpes', null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const boxes = bboxesForRange(layer, result.citation.charStart, result.citation.charEnd)
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.width).toBeGreaterThan(0)
      expect(box.x + box.width).toBeLessThanOrEqual(612)
      expect(box.y + box.height).toBeLessThanOrEqual(792)
    }
  })

  it('draws one rectangle per line for a quote spanning a line break', async () => {
    const layer = await trustLayer()
    const result = verifyQuote(
      layer,
      'from and against any and all claims arising out of',
      await blockStarting('The Settlor'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(bboxesForRange(layer, result.citation.charStart, result.citation.charEnd)).toHaveLength(2)
  })
})
