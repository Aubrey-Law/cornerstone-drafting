import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedSignatureFont } from '@/lib/esign/signatureFont'
import nextConfig from '@/next.config.mjs'

/**
 * A typed signature is stamped in an embedded handwriting face. #498 shipped
 * italic serif as an explicit stopgap; this is the face that replaces it.
 *
 * The properties worth pinning are the asset surviving into the serverless
 * bundle, and the fallback — a font that cannot be read must never be why a
 * client cannot sign.
 */

const FONT = 'assets/fonts/NothingYouCouldDo-Regular.ttf'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the signature font ships and is wired up', () => {
  // Two-sided on purpose: either half passes on its own while the feature is
  // broken. The file can sit in the repo and never reach the serverless bundle,
  // and the config can name a path that no longer exists.
  it('is vendored in the repo, with its licence beside it', () => {
    expect(fs.existsSync(path.join(process.cwd(), FONT)), `${FONT} missing`).toBe(true)
    expect(
      fs.existsSync(path.join(process.cwd(), 'assets/fonts/NothingYouCouldDo-OFL.txt')),
      'OFL licence text missing beside the font',
    ).toBe(true)
  })

  it('is traced into the signing route it is read from', () => {
    // lib/esign/signatureFont.ts reads it with fs at runtime, and /api/sign is
    // the only route that seals a signature.
    const globs = nextConfig.outputFileTracingIncludes?.['/api/sign/[token]'] ?? []
    expect(globs.some(glob => glob.includes('NothingYouCouldDo'))).toBe(true)
  })

  it('is a TrueType file, which is what fontkit can embed', () => {
    // woff2 is what the rest of assets/fonts holds, and fontkit cannot read it.
    // A well-meaning "convert the fonts to woff2" would break signing silently.
    const head = fs.readFileSync(path.join(process.cwd(), FONT)).subarray(0, 4)
    expect([...head]).toEqual([0x00, 0x01, 0x00, 0x00])
  })
})

describe('embedSignatureFont', () => {
  it('embeds the handwriting face', async () => {
    const doc = await PDFDocument.create()
    const { font } = await embedSignatureFont(doc)

    // Asserted on the returned font, not on the saved bytes: pdf-lib packs the
    // font dictionary into a compressed object stream, so grepping output for a
    // font name fails even when the font embedded correctly. #498 learned that
    // the slow way.
    expect(font.name).toContain('NothingYouCouldDo')
  })

  it('holds the capitals where the previous face put them', async () => {
    // The face is bigger on the same nominal size, not smaller: cap height
    // 0.740 em against Times italic's 0.653. Left unscaled it would silently
    // enlarge every typed signature relative to what is already in production.
    const doc = await PDFDocument.create()
    const { font, sizeScale } = await embedSignatureFont(doc)
    const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)

    expect(sizeScale).toBeLessThan(1)
    expect(sizeScale).toBeGreaterThan(0.8)

    // Cap height on the page, which is what the eye reads off the signature
    // line, lands within a hair of the face it replaces.
    const capOnPage = (face: typeof font, size: number, capPerEm: number) => capPerEm * size
    const scriptCap = capOnPage(font, 11 * sizeScale, 0.7402)
    const italicCap = capOnPage(italic, 11, 0.653)
    expect(Math.abs(scriptCap - italicCap)).toBeLessThan(0.05)
  })

  it('draws visibly different glyphs from the face it replaces', async () => {
    // sizeScale keeps the cap height; it must not quietly reproduce the old
    // rendering. Different advance widths prove the glyphs actually changed.
    const doc = await PDFDocument.create()
    const { font, sizeScale } = await embedSignatureFont(doc)
    const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)

    const name = 'Walter White'
    expect(font.widthOfTextAtSize(name, 11 * sizeScale))
      .not.toBeCloseTo(italic.widthOfTextAtSize(name, 11), 1)
  })

  it('falls back to italic serif when the font cannot be read', async () => {
    // The case that protects a signer. A missing or corrupt asset must degrade,
    // never throw: the alternative is a client who cannot sign their agreement
    // and an attorney with no idea why.
    //
    // The module destructures `readFile` from node:fs/promises at import time,
    // so a spy on fs.promises.readFile never reaches the bound reference — the
    // first version of this test did that and passed while asserting nothing.
    // Mock the module and re-import it instead.
    vi.resetModules()
    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { embedSignatureFont: withoutFont } = await import('@/lib/esign/signatureFont')
    const doc = await PDFDocument.create()
    const { font, sizeScale } = await withoutFont(doc)

    expect(font.name).toContain('Times')
    // The fallback is measured in its own metrics, so it is not rescaled.
    expect(sizeScale).toBe(1)
    expect(warn).toHaveBeenCalled()

    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })
})
