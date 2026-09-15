import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import {
  AnchorLocationError,
  locateAnchors,
  toPdfOrigin,
} from '@/lib/esign/nativeAnchors'

/**
 * This module decides where a client's signature is drawn. A wrong answer
 * produces a document that looks finished and is signed in the wrong place, so
 * every test here is about refusing to guess.
 *
 * Fixtures are built with pdf-lib rather than committed as binaries: the
 * expected geometry is then visible in the same file as the assertion.
 */

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792   // US Letter, which lib/engagement/render.ts asserts

/**
 * Body text on every page, because the extractor treats a document averaging
 * fewer than 50 characters per page as a scan. A real engagement agreement is
 * dense; a fixture of nothing but signature lines is not representative and
 * would only be testing the no-text guard.
 */
const BODY = [
  'This engagement agreement sets out the scope of the representation, the fees',
  'payable, and the responsibilities of each party. The client engages the firm',
  'to prepare the estate planning documents described in the attached schedule.',
]

async function pdfWith(
  draws: Array<{ text: string; x: number; y: number; page?: number }>,
  options: { rotate?: number; pages?: number } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pageCount = options.pages ?? 1

  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    if (options.rotate) page.setRotation(degrees(options.rotate))
    BODY.forEach((line, i) => {
      page.drawText(line, { x: 72, y: 700 - i * 16, size: 11, font })
    })
    for (const draw of draws.filter(d => (d.page ?? 1) === index + 1)) {
      page.drawText(draw.text, { x: draw.x, y: draw.y, size: 11, font })
    }
  }
  return Buffer.from(await doc.save())
}

/** An image-only page: drawn content, no text operators at all. */
async function imageOnlyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  page.drawRectangle({ x: 50, y: 50, width: 200, height: 100 })
  return Buffer.from(await doc.save())
}

describe('toPdfOrigin', () => {
  it('flips a top-left box to the bottom-left origin pdf-lib draws in', () => {
    // A 12-high box whose top sits 100 down the page has its baseline
    // 792 - 100 - 12 = 680 up from the bottom.
    expect(toPdfOrigin({ x: 72, y: 100, width: 140, height: 12 }, PAGE_HEIGHT))
      .toEqual({ x: 72, y: 680, width: 140, height: 12 })
  })

  it('is its own inverse, which is why it exists exactly once', () => {
    const original = { x: 72, y: 100, width: 140, height: 12 }
    expect(toPdfOrigin(toPdfOrigin(original, PAGE_HEIGHT), PAGE_HEIGHT)).toEqual(original)
  })
})

describe('locateAnchors', () => {
  it('finds each marker and reports its page and box', async () => {
    const pdf = await pdfWith([
      { text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 200 },
      { text: '[[CLIENT_1_DATE]]', x: 200, y: 170 },
    ])

    const found = await locateAnchors(pdf, ['[[CLIENT_1_SIGNATURE]]', '[[CLIENT_1_DATE]]'])

    expect(found.map(a => a.marker))
      .toEqual(['[[CLIENT_1_SIGNATURE]]', '[[CLIENT_1_DATE]]'])
    expect(found.every(a => a.page === 1)).toBe(true)
    // Drawn at x=200, so the box starts there.
    expect(found[0].bbox.x).toBeCloseTo(200, 0)
    expect(found[0].bbox.width).toBeGreaterThan(0)
    expect(found[0].bbox.height).toBeGreaterThan(0)
  })

  it('round-trips a located box back to where it was drawn', async () => {
    // The end-to-end proof that the two origin conventions are reconciled: the
    // signature line was drawn at y=200 from the bottom, and converting the
    // extracted box back must land there.
    const pdf = await pdfWith([{ text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 200 }])

    const [anchor] = await locateAnchors(pdf, ['[[CLIENT_1_SIGNATURE]]'])
    const drawn = toPdfOrigin(anchor.bbox, PAGE_HEIGHT)

    expect(drawn.y).toBeCloseTo(200, 0)
    expect(drawn.x).toBeCloseTo(200, 0)
  })

  it('refuses a marker that is not there rather than skipping it', async () => {
    const pdf = await pdfWith([{ text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 200 }])

    await expect(locateAnchors(pdf, ['[[SPOUSE_SIGNATURE]]']))
      .rejects.toMatchObject({ code: 'marker_missing' })
  })

  it('refuses a duplicated marker instead of picking one', async () => {
    // Choosing the first would put one signer's signature on another's line,
    // and nothing downstream would notice.
    const pdf = await pdfWith([
      { text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 400 },
      { text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 200 },
    ])

    await expect(locateAnchors(pdf, ['[[CLIENT_1_SIGNATURE]]']))
      .rejects.toMatchObject({ code: 'marker_duplicated' })
  })

  it('refuses a PDF with no extractable text', async () => {
    // A scanned or image-only render. The text layer calls this a valid
    // outcome; for anchoring there is simply nothing to search.
    await expect(locateAnchors(await imageOnlyPdf(), ['[[CLIENT_1_SIGNATURE]]']))
      .rejects.toMatchObject({ code: 'no_text' })
  })

  it('refuses a rotated page, where offsets are right but geometry is not', async () => {
    // The text layer's own type comment says a rotated page keeps correct
    // character offsets and reports null geometry. Correct text with unusable
    // coordinates is the dangerous case: it would stamp confidently and wrongly.
    const pdf = await pdfWith([{ text: '[[CLIENT_1_SIGNATURE]]', x: 200, y: 200 }], { rotate: 90 })

    await expect(locateAnchors(pdf, ['[[CLIENT_1_SIGNATURE]]']))
      .rejects.toMatchObject({ code: 'geometry_unavailable' })
  })

  it('throws AnchorLocationError, so callers can tell these apart from bugs', async () => {
    const pdf = await pdfWith([{ text: 'nothing relevant', x: 72, y: 200 }])

    await expect(locateAnchors(pdf, ['[[CLIENT_1_SIGNATURE]]']))
      .rejects.toBeInstanceOf(AnchorLocationError)
  })
})
