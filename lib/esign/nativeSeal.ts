import 'server-only'

import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { locateAnchors, toPdfOrigin, type LocatedAnchor } from '@/lib/esign/nativeAnchors'

/**
 * Turn a reviewed agreement into a sealed, signed one.
 *
 * **What "sealed" means here, precisely.** This records the SHA-256 of exactly
 * these bytes and prints it on an audit certificate bound into the document.
 * It is *not* a cryptographic PAdES/CAdES signature: there is no certificate
 * chain, no timestamp authority, and nothing a PDF reader will show a green
 * tick for. What it supports is the ordinary evidentiary claim — the firm can
 * show the document, the hash it recorded at signing, and a contemporaneous
 * audit trail, and anyone can recompute the hash to see the bytes are
 * unchanged. That is what ESIGN and UETA actually ask for on an engagement
 * agreement. Do not let a later reader assume more than that from the word
 * "sealed".
 *
 * **Why the bytes are the reviewed bytes.** The signature is drawn onto the
 * PDF the attorney approved and the client read. The document is never
 * re-rendered from source after signing, because then the signed artifact
 * would not be the artifact anyone reviewed — the one property the whole
 * evidentiary story rests on.
 *
 * **Anchor markers remain in the sealed document's text layer.** They must, or
 * they could not have been located. They are invisible because the template
 * renders them white, not because anything here removes them — see stampField.
 * A reader extracting text from a signed agreement will still find them.
 */

/** A signature or date to place, resolved to its anchor marker. */
export interface SealField {
  marker: string
  kind: 'signature' | 'date'
  /** For a drawn signature: PNG bytes. For a typed one: omit. */
  signaturePng?: Buffer
  /** For a typed signature, or the rendered date text. */
  text?: string
}

export interface SealAuditEntry {
  eventType: string
  occurredAt: string
  ip?: string | null
  userAgent?: string | null
  /**
   * Who the event belongs to.
   *
   * A trail that says only "signed" twice cannot show which party did what,
   * and this certificate is the artefact the firm would produce to prove that
   * a particular person signed. Absent for agreement-level events, which is
   * why it is optional rather than guessed at.
   */
  signerName?: string | null
}

export interface SealSigner {
  name: string
  email: string
  /** Typed or drawn. Recorded so the document says which, rather than leaving
   * a reader to infer it from how the signature looks. */
  adoptionMethod?: 'typed' | 'drawn' | null
  signedAt?: Date | null
}

export interface SealInput {
  /** The exact PDF the client reviewed. */
  pdf: Buffer
  fields: SealField[]
  /**
   * Everyone who has signed. A two-party agreement sealed with one entry names
   * whoever sealed last and reads as though the other party did not exist.
   */
  signers: SealSigner[]
  agreementId: string
  /** The disclosure text the signer accepted, verbatim. */
  consentText: string
  auditTrail: SealAuditEntry[]
  /** Injectable for deterministic tests. */
  now?: Date
}

export interface SealedDocument {
  pdf: Buffer
  /** SHA-256 of the sealed bytes — what gets recorded and can be recomputed. */
  sha256: string
  /** SHA-256 of the reviewed document before stamping. */
  sourceSha256: string
}

const MARGIN = 56
const BODY_SIZE = 9
const LINE_HEIGHT = 13

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Cover the anchor's position, then draw the signature there.
 *
 * **The cover is not what hides the marker, and cannot be.** Anchors have to
 * stay in the text layer or they could not be located at all, and a white
 * rectangle drawn over text hides it on screen while leaving it in the content
 * stream — still selectable, still extractable. There is no robust way to
 * remove it: the text is encoded through the font's own glyph mapping, not
 * stored as a literal, so no string edit would find it in a real LibreOffice
 * render.
 *
 * What keeps markers off the client's screen is the template rendering them in
 * white, which docs/integrations/firma-engagement-poc.md established and
 * verified ("the invisible marker text was not exposed to the signer"). That
 * requirement is unchanged by owning the stamping step — it was never the
 * vendor's to solve.
 *
 * This rectangle is belt and braces on top of that: if a template ever ships
 * with visible anchors, the signature still lands over them rather than beside
 * them. It is padded slightly beyond the measured box because glyph bounding
 * boxes do not include antialiasing spill at the edges.
 */
function stampField(
  page: import('pdf-lib').PDFPage,
  anchor: LocatedAnchor,
  field: SealField,
  font: import('pdf-lib').PDFFont,
  /**
   * The face for a typed signature.
   *
   * Helvetica made a typed name read as body text — a word inserted into the
   * sentence rather than a signature. Italic serif separates it without
   * pretending to be handwriting; a real script face needs an embedded font
   * and is deliberately a separate change.
   */
  signatureFont: import('pdf-lib').PDFFont,
  image: import('pdf-lib').PDFImage | null,
): void {
  const box = toPdfOrigin(anchor.bbox, page.getHeight())
  const pad = 1.5

  page.drawRectangle({
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
    color: rgb(1, 1, 1),
  })

  if (image) {
    // Fit the signature into the anchor's height, keeping its aspect ratio, so
    // a wide scrawl does not overrun the line it belongs on.
    const scale = box.height / image.height
    page.drawImage(image, {
      x: box.x,
      y: box.y,
      width: Math.min(image.width * scale, box.width * 3),
      height: box.height,
    })
    return
  }

  const text = field.text ?? ''
  if (!text) return
  page.drawText(text, {
    x: box.x,
    y: box.y + box.height * 0.2,
    size: Math.min(box.height, 11),
    font: field.kind === 'signature' ? signatureFont : font,
    color: rgb(0, 0, 0),
  })
}

/**
 * Append the audit certificate.
 *
 * Bound into the same file rather than kept alongside it: a certificate in a
 * separate document is the one that goes missing, and the hash it attests to
 * is meaningless once the two are separated.
 */
function drawCertificate(
  doc: PDFDocument,
  input: SealInput,
  sourceSha256: string,
  font: import('pdf-lib').PDFFont,
  bold: import('pdf-lib').PDFFont,
  now: Date,
): void {
  let page = doc.addPage([612, 792])
  let y = 792 - MARGIN

  const line = (text: string, options: { bold?: boolean; gap?: number } = {}) => {
    if (y < MARGIN + LINE_HEIGHT) {
      page = doc.addPage([612, 792])
      y = 792 - MARGIN
    }
    page.drawText(text, {
      x: MARGIN,
      y,
      size: BODY_SIZE,
      font: options.bold ? bold : font,
      color: rgb(0, 0, 0),
    })
    y -= options.gap ?? LINE_HEIGHT
  }

  line('ELECTRONIC SIGNATURE AUDIT CERTIFICATE', { bold: true, gap: LINE_HEIGHT * 1.6 })

  line('Agreement', { bold: true })
  line(`Agreement ID: ${input.agreementId}`)
  line(`Certificate generated: ${now.toISOString()}`, { gap: LINE_HEIGHT * 1.6 })

  line(input.signers.length === 1 ? 'Signer' : 'Signers', { bold: true })
  input.signers.forEach((signer, index) => {
    line(`Name: ${signer.name}`)
    line(`Email: ${signer.email}`)
    if (signer.signedAt) line(`Signed: ${signer.signedAt.toISOString()}`)
    // Said plainly rather than left to be inferred from how the mark looks,
    // which matters more now that a typed name is set in italic.
    if (signer.adoptionMethod) {
      line(signer.adoptionMethod === 'drawn'
        ? 'Signature adopted by drawing.'
        : 'Signature adopted by typing a name.')
    }
    const last = index === input.signers.length - 1
    y -= last ? LINE_HEIGHT * 0.6 : LINE_HEIGHT * 0.4
  })
  y -= LINE_HEIGHT

  line('Document integrity', { bold: true })
  line(`SHA-256 of the reviewed document: ${sourceSha256}`)
  // The sealed hash cannot be printed inside the document it describes — a
  // hash of bytes that include the hash is not computable. It is recorded
  // against the agreement instead, and this says so rather than leaving a
  // reader to wonder why one of the pair is missing.
  line('SHA-256 of this sealed document: recorded against the agreement on sealing.')
  line('This certificate records hashes and a contemporaneous trail. It is not a')
  line('cryptographic PAdES signature and carries no certificate chain.', {
    gap: LINE_HEIGHT * 1.6,
  })

  line('Consent', { bold: true })
  line(`SHA-256 of the disclosure accepted: ${sha256(Buffer.from(input.consentText, 'utf8'))}`)
  for (const chunk of wrap(input.consentText, 95)) line(chunk)
  y -= LINE_HEIGHT * 0.6

  line('Audit trail', { bold: true })
  for (const entry of input.auditTrail) {
    const where = [entry.ip, entry.userAgent].filter(Boolean).join(' · ')
    // Attribute the event. Without a name, two signers produce one list in
    // which nothing says who opened, consented or signed.
    const who = entry.signerName ? `  ${entry.signerName}` : ''
    line(`${entry.occurredAt}  ${entry.eventType}${who}${where ? `  ${where}` : ''}`)
  }
}

/** Break text onto lines that fit the certificate's measure. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      if (current) lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

export async function sealSignedAgreement(input: SealInput): Promise<SealedDocument> {
  const sourceSha256 = sha256(input.pdf)

  // Locate before mutating: if an anchor cannot be resolved, nothing should
  // have been drawn. locateAnchors throws rather than guessing.
  const anchors = await locateAnchors(input.pdf, input.fields.map(field => field.marker))
  const byMarker = new Map(anchors.map(anchor => [anchor.marker, anchor]))

  const doc = await PDFDocument.load(input.pdf)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const signatureFont = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const pages = doc.getPages()

  for (const field of input.fields) {
    const anchor = byMarker.get(field.marker)
    if (!anchor) continue   // locateAnchors would have thrown; this is for the type
    const page = pages[anchor.page - 1]
    if (!page) {
      throw new Error(`Anchor ${field.marker} reports page ${anchor.page}, which the document does not have`)
    }
    const image = field.signaturePng ? await doc.embedPng(field.signaturePng) : null
    stampField(page, anchor, field, font, signatureFont, image)
  }

  drawCertificate(doc, input, sourceSha256, font, bold, input.now ?? new Date())

  // Flatten any interactive form so nothing in the sealed file remains
  // editable through ordinary PDF tooling.
  doc.getForm().flatten()

  const sealed = Buffer.from(await doc.save())
  return { pdf: sealed, sha256: sha256(sealed), sourceSha256 }
}
