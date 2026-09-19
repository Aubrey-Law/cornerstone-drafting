import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import { appendSignaturePage, SignaturePageError } from '@/lib/esign/signaturePage'
import { locateAnchors } from '@/lib/esign/nativeAnchors'
import { documentAnchorMarkers } from '@/lib/esign/subject'
import { sealSignedAgreement } from '@/lib/esign/nativeSeal'
import { sealFieldsFor } from '@/lib/esign/sealFields'

/**
 * A signature page for a document the firm did not author.
 *
 * The engagement template carries its own markers. An upload carries nothing
 * and may be a scan with no text at all, so the page is generated instead of
 * located. What matters is that the result is something locateAnchors can
 * actually work with, and that the markers stay invisible to the signer.
 */

async function uploadedPdf(body: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  body.forEach((line, i) => page.drawText(line, { x: 72, y: 700 - i * 16, size: 11, font }))
  return Buffer.from(await doc.save())
}

/** A page with no text at all — what a scan looks like to the extractor. */
async function scannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.drawRectangle({ x: 100, y: 400, width: 300, height: 200, color: rgb(0.85, 0.85, 0.85) })
  return Buffer.from(await doc.save())
}

/** The decoded content stream for one page, as PDF operators. */
async function pageContent(pdf: Buffer, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(pdf)
  const contents = doc.getPages()[pageIndex].node.Contents()
  if (!contents) throw new Error(`page ${pageIndex} has no content stream`)
  const refs = 'asArray' in contents ? contents.asArray() : [contents]
  return refs
    .map(ref => {
      const stream = doc.context.lookup(ref)
      return stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
        : ''
    })
    .join('\n')
}

/**
 * How pdf-lib writes a string into a content stream: hex, not ASCII.
 * `drawText('[[SIGN_1_SIGNATURE]]')` emits `<5B5B53...5D5D> Tj`.
 */
function asPdfHex(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase()
}

const signers = [{ name: 'Walter White', role: 'Client' }, { name: 'Skylar White', role: 'Spouse' }]

describe('appendSignaturePage', () => {
  it('adds one page and leaves the original pages alone', async () => {
    const source = await uploadedPdf(['A HIPAA authorization.', 'Second line.'])
    const prepared = await appendSignaturePage(source, signers)

    const before = await PDFDocument.load(source)
    const after = await PDFDocument.load(prepared)
    expect(after.getPageCount()).toBe(before.getPageCount() + 1)

    // The uploaded content still reads exactly as it did.
    const layer = await buildPdfTextLayer(prepared)
    expect(layer.text).toContain('A HIPAA authorization.')
  })

  it('produces markers locateAnchors can actually find', async () => {
    // The whole point. A page whose markers are present but unfindable would
    // fail at signing time, on a public route, with a client waiting.
    const prepared = await appendSignaturePage(await uploadedPdf(['Body.']), signers)
    const markers = [1, 2].flatMap(p => {
      const { signature, date } = documentAnchorMarkers(p)
      return [signature, date]
    })

    const located = await locateAnchors(prepared, markers)
    expect(located.map(a => a.marker).sort()).toEqual([...markers].sort())
    // Every anchor needs a usable box, on the appended page.
    for (const anchor of located) {
      expect(anchor.bbox, `${anchor.marker} has no geometry`).toBeTruthy()
      expect(anchor.page).toBe(2)
    }
  })

  it('works on a scan with no text layer, which is why the page is generated', async () => {
    // An uploaded PDF may be an image with nothing to search. The engagement
    // path cannot sign one at all; this can, because the appended page supplies
    // the text.
    const scan = await scannedPdf()
    expect((await buildPdfTextLayer(scan)).status).toBe('no_text')

    const prepared = await appendSignaturePage(scan, [{ name: 'Walter White' }])
    const { signature, date } = documentAnchorMarkers(1)
    const located = await locateAnchors(prepared, [signature, date])
    expect(located).toHaveLength(2)
  })

  it('keeps the markers off the page the signer looks at', async () => {
    // White on white: in the text layer for the extractor, invisible to the
    // reader. A visible [[SIGN_1_SIGNATURE]] on an executed document is exactly
    // what the first two-party engagement agreement shipped with.
    const prepared = await appendSignaturePage(await uploadedPdf(['Body.']), signers)
    const content = await pageContent(prepared, 1)

    // Every marker is drawn while white is the fill colour. Asserting the file
    // merely *contains* `1 1 1 rg` somewhere would pass on a page that set it
    // once and then drew the markers in black.
    for (const position of [1, 2]) {
      const { signature, date } = documentAnchorMarkers(position)
      for (const marker of [signature, date]) {
        const at = content.indexOf(asPdfHex(marker))
        expect(at, `${marker} is not drawn on the page`).toBeGreaterThan(-1)
        const fillBefore = content.slice(0, at).match(/(\d[\d.]* \d[\d.]* \d[\d.]* rg)(?![\s\S]*rg)/)
        expect(fillBefore?.[1], `${marker} is not drawn in white`).toBe('1 1 1 rg')
      }
    }

    // And the signer-visible text is not white, or the page would be blank.
    const nameAt = content.indexOf(asPdfHex('Walter White'))
    const nameFill = content.slice(0, nameAt).match(/(\d[\d.]* \d[\d.]* \d[\d.]* rg)(?![\s\S]*rg)/)
    expect(nameFill?.[1]).toBe('0 0 0 rg')
  })

  it('prints each signer once, with their line and their date', async () => {
    const prepared = await appendSignaturePage(await uploadedPdf(['Body.']), signers)
    const layer = await buildPdfTextLayer(prepared)

    expect(layer.text).toContain('SIGNATURE PAGE')
    expect(layer.text).toContain('Walter White')
    expect(layer.text).toContain('Skylar White')
    expect(layer.text).toContain('CLIENT')
    expect(layer.text).toContain('SPOUSE')
  })

  it('refuses a document that already carries these markers', async () => {
    // Re-preparing a prepared document, or uploading one that came out of this
    // flow. Two copies of a marker make locateAnchors refuse to choose — right,
    // but at send time and in the language of anchors. Say it here instead.
    const once = await appendSignaturePage(await uploadedPdf(['Body.']), signers)
    await expect(appendSignaturePage(once, signers)).rejects.toThrow(SignaturePageError)
    await expect(appendSignaturePage(once, signers)).rejects.toThrow(/already contains signature markers/i)
  })

  it('seals a signature onto the page it generated', async () => {
    // The end-to-end claim, and the only one that proves the parts fit: append
    // a page, seal marks through the normal path, and read the result back.
    // Every piece here is the production one — appendSignaturePage,
    // sealFieldsFor with the document namespace, sealSignedAgreement.
    const prepared = await appendSignaturePage(await uploadedPdf(['A HIPAA authorization.']), signers)

    const sealed = await sealSignedAgreement({
      pdf: prepared,
      fields: sealFieldsFor([
        { position: 1, signedAt: new Date('2026-09-18T14:00:00Z'), typedName: 'Walter White' },
        { position: 2, signedAt: new Date('2026-09-18T15:00:00Z'), typedName: 'Skylar White' },
      ], 'America/New_York', documentAnchorMarkers),
      signers: signers.map((signer, i) => ({
        name: signer.name,
        email: `s${i}@example.com`,
        adoptionMethod: 'typed' as const,
        signedAt: new Date('2026-09-18T15:00:00Z'),
      })),
      agreementId: 'request-1',
      consentText: 'I agree to sign electronically.',
      auditTrail: [{ eventType: 'signed', occurredAt: '2026-09-18T15:00:00Z' }],
      now: new Date('2026-09-18T15:00:01Z'),
    })

    const layer = await buildPdfTextLayer(sealed.pdf)
    // Both typed signatures are on the document, with their own dates.
    expect(layer.text).toContain('September 18, 2026')
    // The uploaded content survived.
    expect(layer.text).toContain('A HIPAA authorization.')
    // And the certificate is bound into the same file.
    expect(layer.text).toContain('ELECTRONIC SIGNATURE AUDIT CERTIFICATE')
    expect(sealed.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuses with no signers', async () => {
    await expect(appendSignaturePage(await uploadedPdf(['Body.']), []))
      .rejects.toThrow(/at least one signer/i)
  })

  it('refuses more signers than fit on the page', async () => {
    // Beyond capacity the block runs off the bottom and the markers land
    // outside the visible area — locateAnchors would still find them and the
    // seal would stamp a signature nobody can see.
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Signer ${i + 1}` }))
    await expect(appendSignaturePage(await uploadedPdf(['Body.']), many))
      .rejects.toThrow(/holds at most/i)
  })
})
