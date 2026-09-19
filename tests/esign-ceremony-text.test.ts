import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CEREMONY_ATTESTATION_TEXT, MAX_SIGNERS } from '@/lib/esign/ceremony'
import * as documentSignature from '@/lib/esign/documentSignature'
import { appendSignaturePage } from '@/lib/esign/signaturePage'
import { PDFDocument } from 'pdf-lib'

/**
 * The attestation an attorney agrees to, and the ceiling the dialog offers.
 *
 * Both are shown in a browser and enforced on a server, which is the whole
 * reason they live in one module. These are the properties that keep them
 * there.
 */

describe('the ceremony module', () => {
  it('is importable from a client component', () => {
    // A `server-only` import anywhere in its graph would make the send dialog
    // fail to build, and it would fail at build time in CI rather than here —
    // with an error about the module graph rather than about this constant.
    // No imports at all is the strongest form of the property and the easiest
    // to check: nothing can drag `server-only` in behind it. The prose above
    // the constants says so; this is what holds someone to it.
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/esign/ceremony.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(/)
  })

  it('is the same string the service stores, not a copy of it', () => {
    // Identity, not equality: two separately declared strings that happen to
    // match today are exactly the drift this arrangement exists to prevent.
    expect(documentSignature.CEREMONY_ATTESTATION_TEXT).toBe(CEREMONY_ATTESTATION_TEXT)
  })

  it('names every instrument Massachusetts excludes', () => {
    for (const term of ['will', 'trust', 'power of attorney', 'health care proxy', '190B']) {
      expect(CEREMONY_ATTESTATION_TEXT.toLowerCase()).toContain(term.toLowerCase())
    }
  })
})

describe('MAX_SIGNERS', () => {
  async function blankPdf(): Promise<Buffer> {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    return Buffer.from(await doc.save())
  }

  it('is what a signature page actually holds', async () => {
    // The dialog stops offering "Add signer" at this number, and the service
    // refuses above it with a message naming it. Both are lies unless the page
    // agrees: this was written as eight while the page refused at seven, so an
    // attorney could fill in a seventh signer, send, and be told the limit was
    // six.
    //
    // Sent with a title, which is what the route always passes — the title line
    // costs vertical space, so a capacity measured without one would be the
    // wrong number.
    const title = { title: 'HIPAA Authorization' }
    const signers = Array.from({ length: MAX_SIGNERS }, (_, index) => ({
      name: `Signer ${index + 1}`, role: 'Client',
    }))
    await expect(appendSignaturePage(await blankPdf(), signers, title)).resolves.toBeInstanceOf(Buffer)
    await expect(appendSignaturePage(await blankPdf(), [...signers, { name: 'One too many' }], title))
      .rejects.toThrow(/holds at most/i)
  })
})
