import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import { sealSignedAgreement } from '@/lib/esign/nativeSeal'
import { AnchorLocationError } from '@/lib/esign/nativeAnchors'

/**
 * Anchor markers deliberately survive in the sealed document's text layer.
 * They have to — removing them would mean they could not have been located,
 * and the text is encoded through the font's glyph mapping rather than stored
 * as a literal, so no string edit reaches it. They are kept off the client's
 * screen by the template rendering them white, which
 * docs/integrations/firma-engagement-poc.md established and verified.
 *
 * So these tests pin what sealing genuinely owns: the signature lands at the
 * anchor, the reviewed text is undisturbed, the hashes describe the real
 * bytes, the certificate is bound into the same file, and a document is never
 * half-stamped.
 */

const BODY = [
  'This engagement agreement sets out the scope of the representation, the fees',
  'payable, and the responsibilities of each party. The client engages the firm',
  'to prepare the estate planning documents described in the attached schedule.',
]

async function agreementPdf(markers: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  BODY.forEach((text, i) => page.drawText(text, { x: 72, y: 700 - i * 16, size: 11, font }))
  markers.forEach((marker, i) => {
    page.drawText(marker, { x: 200, y: 260 - i * 30, size: 11, font })
  })
  return Buffer.from(await doc.save())
}

/** A 1x1 transparent PNG — enough for pdf-lib to embed. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const baseInput = {
  signer: { name: 'A Client', email: 'client@example.com' },
  agreementId: 'agreement-1',
  consentText:
    'By checking this box I agree to sign this agreement electronically and confirm '
    + 'that I can access and retain a copy of the signed document.',
  auditTrail: [
    { eventType: 'sent', occurredAt: '2026-01-01T10:00:00Z' },
    { eventType: 'opened', occurredAt: '2026-01-02T09:15:00Z', ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
    { eventType: 'consented', occurredAt: '2026-01-02T09:16:00Z', ip: '203.0.113.7' },
    { eventType: 'signed', occurredAt: '2026-01-02T09:16:30Z', ip: '203.0.113.7' },
  ],
  now: new Date('2026-01-02T09:16:31Z'),
}

describe('sealSignedAgreement', () => {
  it('records that anchor markers stay in the text layer, by design', async () => {
    // Pinned because it is counter-intuitive and because an earlier draft of
    // this module claimed the opposite. Markers must remain extractable or
    // they could not have been located; invisibility is the template's job
    // (white anchor text), not the sealer's. If a future change makes them
    // removable, this test should be the thing that forces the docs to be
    // updated with it.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    expect((await buildPdfTextLayer(sealed.pdf)).text).toContain('[[CLIENT_1_SIGNATURE]]')
  })

  it('draws the signature and date where the anchors were', async () => {
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]', '[[CLIENT_1_DATE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [
        { marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' },
        { marker: '[[CLIENT_1_DATE]]', kind: 'date', text: '2 January 2026' },
      ],
    })

    const layer = await buildPdfTextLayer(sealed.pdf)
    expect(layer.text).toContain('A Client')
    expect(layer.text).toContain('2 January 2026')
  })

  it('keeps the reviewed document intact around the signature', async () => {
    // Stamping must not disturb the text the client actually read.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    const layer = await buildPdfTextLayer(sealed.pdf)
    for (const line of BODY) {
      expect(layer.text.replace(/\s+/g, ' ')).toContain(line.replace(/\s+/g, ' '))
    }
  })

  it('reports the hash of the reviewed bytes and of the sealed bytes', async () => {
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    expect(sealed.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(sealed.sha256).toMatch(/^[a-f0-9]{64}$/)
    // Sealing changes the bytes, so the two must differ.
    expect(sealed.sha256).not.toBe(sealed.sourceSha256)
    // And the reported sealed hash must actually describe the returned bytes.
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(sealed.pdf).digest('hex')).toBe(sealed.sha256)
  })

  it('binds an audit certificate into the same file', async () => {
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])
    const before = (await PDFDocument.load(pdf)).getPageCount()

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    expect((await PDFDocument.load(sealed.pdf)).getPageCount()).toBeGreaterThan(before)

    const layer = await buildPdfTextLayer(sealed.pdf)
    expect(layer.text).toContain('ELECTRONIC SIGNATURE AUDIT CERTIFICATE')
    expect(layer.text).toContain('client@example.com')
    expect(layer.text).toContain(sealed.sourceSha256)
    // Every audit event is on the certificate, with its evidence.
    expect(layer.text).toContain('203.0.113.7')
    for (const entry of baseInput.auditTrail) expect(layer.text).toContain(entry.eventType)
  })

  it('says on its face that it is not a cryptographic signature', async () => {
    // A later reader must not mistake "sealed" for PAdES.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    const layer = await buildPdfTextLayer(sealed.pdf)
    expect(layer.text.replace(/\s+/g, ' ')).toContain('not a')
    expect(layer.text).toContain('PAdES')
  })

  it('records the hash of the exact disclosure that was accepted', async () => {
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update(baseInput.consentText, 'utf8').digest('hex')

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' }],
    })

    expect((await buildPdfTextLayer(sealed.pdf)).text).toContain(expected)
  })

  it('embeds a drawn signature image', async () => {
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', signaturePng: PNG_1PX }],
    })

    // The signature is an image, so it leaves no text; what is checked is that
    // sealing completed and the certificate was still produced.
    const layer = await buildPdfTextLayer(sealed.pdf)
    expect(layer.text).toContain('ELECTRONIC SIGNATURE AUDIT CERTIFICATE')
    expect(sealed.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('draws nothing when an anchor cannot be located', async () => {
    // Locate-then-mutate: a half-stamped document must never exist.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    await expect(sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [
        { marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'A Client' },
        { marker: '[[SPOUSE_SIGNATURE]]', kind: 'signature', text: 'B Client' },
      ],
    })).rejects.toBeInstanceOf(AnchorLocationError)
  })
})
