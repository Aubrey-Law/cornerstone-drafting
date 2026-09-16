import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import { sealSignedAgreement } from '@/lib/esign/nativeSeal'
import { sealFieldsFor } from '@/lib/esign/sealFields'
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
  signers: [{ name: 'A Client', email: 'client@example.com' }],
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

  it('carries both signers when a couple signs', async () => {
    // The first real two-party agreement was executed with one signature on it.
    // Each signing rebuilt the sealed file from the approved PDF and stamped a
    // single signer, so the second seal erased the first — the spouse's typed
    // name never reached the document while her session, artifact and audit
    // trail all recorded success.
    //
    // Both are typed here so both land in the text layer; a drawn signature is
    // an image and is covered by the embedding test below.
    const pdf = await agreementPdf([
      '[[CLIENT_1_SIGNATURE]]',
      '[[CLIENT_1_DATE]]',
      '[[CLIENT_2_SIGNATURE]]',
      '[[CLIENT_2_DATE]]',
    ])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: sealFieldsFor([
        { position: 2, signedAt: new Date('2026-01-02T09:16:30Z'), typedName: 'Skylar White' },
        { position: 1, signedAt: new Date('2026-01-03T14:02:00Z'), typedName: 'Walter White' },
      ]),
    })

    const layer = await buildPdfTextLayer(sealed.pdf)
    expect(layer.text).toContain('Walter White')
    expect(layer.text).toContain('Skylar White')
    expect(layer.text).toContain('January 3, 2026')
    expect(layer.text).toContain('January 2, 2026')
  })

  it('names every signer on the certificate, with how each one signed', async () => {
    // The certificate used to take a single signer and the route filled it with
    // whoever was signing right then, so a couple's executed agreement named
    // one party and read as though the other did not exist.
    //
    // The adoption method is stated rather than left to be inferred from how
    // the mark looks — which matters now that a typed name is set in italic.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'Walter White' }],
      signers: [
        {
          name: 'Walter White',
          email: 'walter@example.com',
          adoptionMethod: 'typed',
          signedAt: new Date('2026-01-02T09:16:30Z'),
        },
        {
          name: 'Skylar White',
          email: 'skylar@example.com',
          adoptionMethod: 'drawn',
          signedAt: new Date('2026-01-03T14:02:00Z'),
        },
      ],
    })

    const { text } = await buildPdfTextLayer(sealed.pdf)
    expect(text).toContain('Walter White')
    expect(text).toContain('walter@example.com')
    expect(text).toContain('Skylar White')
    expect(text).toContain('skylar@example.com')
    expect(text).toContain('Signature adopted by typing a name.')
    expect(text).toContain('Signature adopted by drawing.')
  })

  it('attributes each audit trail entry to the signer it belongs to', async () => {
    // Two signers produce ten events. Without a name the certificate is one
    // undifferentiated list, and cannot show that a particular person signed.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [{ marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'Walter White' }],
      auditTrail: [
        { eventType: 'sent', occurredAt: '2026-01-01T10:00:00Z' },
        { eventType: 'signed', occurredAt: '2026-01-02T09:16:30Z', signerName: 'Walter White' },
        { eventType: 'signed', occurredAt: '2026-01-03T14:02:00Z', signerName: 'Skylar White' },
      ],
    })

    // Whitespace is normalised by the extractor, so match on order not spacing.
    const { text } = await buildPdfTextLayer(sealed.pdf)
    expect(text).toMatch(/2026-01-02T09:16:30Z\s+signed\s+Walter White/)
    expect(text).toMatch(/2026-01-03T14:02:00Z\s+signed\s+Skylar White/)
    // An agreement-level event has no signer and must not be attributed to one.
    expect(text).toMatch(/2026-01-01T10:00:00Z\s+sent(?!\s+\w+ \w)/)
  })

  it('sets a typed signature in a different face from the date', async () => {
    // Helvetica made a typed name read as body text — a word inserted into the
    // sentence rather than a signature.
    //
    // "Looks like a signature" is not assertable. Metrics are: the same string
    // stamped as a signature and as a date comes out a different width only if
    // the two are drawn in different faces.
    const pdf = await agreementPdf(['[[CLIENT_1_SIGNATURE]]', '[[CLIENT_1_DATE]]'])

    const sealed = await sealSignedAgreement({
      ...baseInput,
      pdf,
      fields: [
        { marker: '[[CLIENT_1_SIGNATURE]]', kind: 'signature', text: 'Walter White' },
        { marker: '[[CLIENT_1_DATE]]', kind: 'date', text: 'Walter White' },
      ],
    })

    // bbox is null on a rotated page, where the extractor keeps the text and
    // drops the geometry rather than emit boxes it knows are wrong.
    const layer = await buildPdfTextLayer(sealed.pdf)
    const widths = layer.spans
      .filter(span => layer.text.slice(span.charStart, span.charEnd).includes('Walter White'))
      .map(span => span.bbox?.width)
      .filter((width): width is number => width !== undefined)

    expect(widths).toHaveLength(2)
    expect(widths[0]).not.toBeCloseTo(widths[1], 1)
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
