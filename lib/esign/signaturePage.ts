import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import { documentAnchorMarkers } from '@/lib/esign/subject'

/**
 * A signature page for a document the firm did not author.
 *
 * An engagement agreement is rendered from a template that carries
 * `[[CLIENT_n_SIGNATURE]]` markers, which is how locateAnchors finds where to
 * stamp. An uploaded PDF carries nothing, and could be a scan with no text
 * layer at all — so there is no marker to find and no text to search.
 *
 * So the page is generated rather than located. It is appended to whatever was
 * uploaded, it carries the markers this engine already understands, and from
 * that point the existing sealing path works unchanged: the markers are drawn
 * in white so the signer sees ruled lines rather than machine text, exactly the
 * "white searchable anchors" arrangement the engagement template uses
 * (docs/integrations/firma-engagement-poc.md:58).
 *
 * It also means a scanned PDF can be signed. The appended page has text even
 * when nothing before it does, so `buildPdfTextLayer` has something to read.
 */

/** US Letter, matching what lib/engagement/render.ts already asserts. */
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 72

export interface SignaturePageSigner {
  name: string
  /** What to print above the signature line, e.g. "Client" or "Spouse". */
  role?: string
}

export class SignaturePageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignaturePageError'
  }
}

/**
 * Refuse a document that already contains the markers we are about to add.
 *
 * An uploaded PDF could be anything, including a copy of an engagement
 * agreement or a document someone previously ran through this flow. Two copies
 * of one marker make locateAnchors throw `marker_duplicated`, which is the
 * right outcome but arrives at send time with a message about anchors. Catching
 * it here says what actually happened, and — more importantly — makes it
 * impossible for the marker to resolve to the wrong one of the two.
 */
async function refuseIfMarkersPresent(pdf: Buffer, markers: string[]): Promise<void> {
  const layer = await buildPdfTextLayer(pdf)
  // A scan has no text, so it cannot contain a marker. That is a supported
  // input here, not a failure — the appended page supplies the text.
  if (layer.status === 'no_text') return

  const present = markers.filter(marker => layer.text.includes(marker))
  if (present.length > 0) {
    throw new SignaturePageError(
      `This document already contains signature markers (${present.join(', ')}), so a signature `
        + 'page cannot be added to it. It looks like a document that has already been prepared for '
        + 'signing, or one generated from a firm template that carries its own signature lines.',
    )
  }
}

/**
 * Append a signature page and return the new document.
 *
 * The returned bytes are what recipients see and what gets sealed; the upload
 * itself is left untouched so the original is always recoverable.
 */
export async function appendSignaturePage(
  pdf: Buffer,
  signers: SignaturePageSigner[],
  options: { title?: string } = {},
): Promise<Buffer> {
  if (signers.length === 0) {
    throw new SignaturePageError('A signature page needs at least one signer')
  }

  const markers = signers.flatMap((_, index) => {
    const { signature, date } = documentAnchorMarkers(index + 1)
    return [signature, date]
  })
  await refuseIfMarkersPresent(pdf, markers)

  const doc = await PDFDocument.load(pdf)
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const black = rgb(0, 0, 0)
  // The marker has to be in the text layer and invisible on the page. White on
  // white does both: locateAnchors reads it, the signer never sees it, and the
  // seal paints over the spot before drawing the signature.
  const white = rgb(1, 1, 1)

  let y = PAGE_HEIGHT - MARGIN

  page.drawText('SIGNATURE PAGE', { x: MARGIN, y, size: 14, font: bold, color: black })
  y -= 22

  if (options.title) {
    page.drawText(options.title.slice(0, 90), { x: MARGIN, y, size: 11, font: helvetica, color: black })
    y -= 18
  }

  page.drawText('The parties have signed this document electronically as of the dates shown.', {
    x: MARGIN, y, size: 10, font: helvetica, color: black,
  })
  y -= 48

  const signatureWidth = 250
  const dateX = MARGIN + signatureWidth + 40
  const dateWidth = 130

  for (const [index, signer] of signers.entries()) {
    const position = index + 1
    const { signature, date } = documentAnchorMarkers(position)

    if (signer.role) {
      page.drawText(signer.role.toUpperCase().slice(0, 40), {
        x: MARGIN, y, size: 9, font: bold, color: black,
      })
    }
    y -= 34

    // The marker sits just above its rule, which is where the seal will draw
    // the signature — stampField covers the marker's own box first.
    page.drawText(signature, { x: MARGIN + 2, y: y + 4, size: 11, font: helvetica, color: white })
    page.drawText(date, { x: dateX + 2, y: y + 4, size: 11, font: helvetica, color: white })

    page.drawLine({
      start: { x: MARGIN, y }, end: { x: MARGIN + signatureWidth, y },
      thickness: 0.75, color: black,
    })
    page.drawLine({
      start: { x: dateX, y }, end: { x: dateX + dateWidth, y },
      thickness: 0.75, color: black,
    })
    y -= 13

    page.drawText(signer.name.slice(0, 60), { x: MARGIN, y, size: 9, font: helvetica, color: black })
    page.drawText('Date', { x: dateX, y, size: 9, font: helvetica, color: black })
    y -= 40

    // A page holds roughly eight signers; beyond that the block would run off
    // the bottom and the markers would sit outside the visible area.
    if (y < MARGIN + 60 && position < signers.length) {
      throw new SignaturePageError(
        `A signature page holds at most ${position} signers; ${signers.length} were given`,
      )
    }
  }

  return Buffer.from(await doc.save())
}
