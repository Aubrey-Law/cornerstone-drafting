import { describe, expect, it } from 'vitest'
import { renderEngagementAgreement } from '@/lib/engagement/render'
import { DocxPdfConvertError } from '@/lib/docxPdfConvert'
import { allEngagementAnchorMarkers, engagementAnchorMarkers } from '@/lib/engagement/anchors'
import { ENGAGEMENT_TEMPLATES } from '@/lib/engagement/templates'
import { AnchorLocationError, locateAnchors, toPdfOrigin } from '@/lib/esign/nativeAnchors'

/**
 * The one assumption the native signing engine rests on that unit tests cannot
 * reach.
 *
 * `locateAnchors` needs a usable bounding box for every anchor span. Every test
 * of it so far builds a synthetic PDF with pdf-lib, where the text is drawn in
 * one simple run with a standard font. A real agreement is produced by
 * LibreOffice from a DOCX: subset fonts, its own text positioning, runs split
 * wherever Word split them. Whether *that* yields geometry the extractor can
 * read has never been checked anywhere.
 *
 * It matters because the failure is quiet. If the boxes come back null or
 * wrong, a signature is drawn beside the signature line instead of on it, on a
 * fee agreement that otherwise looks properly executed — and nobody re-reads an
 * executed agreement until it is disputed.
 *
 * Marker *text* surviving conversion is already proven continuously: validatePdf
 * in lib/engagement/render.ts asserts each anchor appears exactly once on every
 * render, in production, today. This probe is only about geometry.
 *
 * Run it with: npm run check:engagement-anchors
 */

const LETTER_WIDTH = 612
const LETTER_HEIGHT = 792

/**
 * One input per shipped master, because geometry is a property of the document
 * and the masters lay their signature blocks out differently.
 *
 * Every field that varies is read off the master rather than written out, so a
 * master added later is probed without editing this file — and so an input can
 * never describe a client the master it targets could not represent.
 */
const inputs = ENGAGEMENT_TEMPLATES.map(template => ({
  template,
  input: {
    practiceArea: template.practiceArea,
    clientMode: template.clientMode,
    agreementDate: '2026-07-12',
    primary: { name: 'Alex Client', email: 'alex@example.com' },
    // A solo agreement has no second party, and one supplied anyway is a
    // validation error rather than a field the master quietly ignores.
    spouse: template.clientMode === 'couple'
      ? { name: 'Jordan Client', email: 'jordan@example.com' }
      : null,
    legalPlan: template.legalPlans?.[0] ?? null,
    // A plan-funded letter states no firm fee, so it is not asked for one.
    fee: template.statesFirmFee
      ? { amount: 7500, paymentTerms: 'Half now; half before signing.' }
      : { amount: 0, paymentTerms: '' },
    scopeKey: template.scopeKey,
    optionalClauseKeys: [] as string[],
    emailMessage: '',
    expirationHours: 72,
  },
}))

const cases = inputs.map(entry => [entry.template.masterKey, entry] as const)
/** Only a master with two signers can put one signer's anchor on another's line. */
const multiSignerCases = cases.filter(([, entry]) => entry.template.recipientCount > 1)

/**
 * Render through the real worker, translating its transport failures into
 * something that names the cause.
 *
 * The convert client reports a rejection as `Convert worker failed (401)` from
 * inside lib/docxPdfConvert.ts, which is accurate but points at the client
 * rather than at the two variables that actually disagree. The probe is where
 * someone is configuring those variables for the first time, so it is where the
 * mapping from status code to cause belongs.
 */
async function renderThroughWorker(input: unknown) {
  try {
    return await renderEngagementAgreement(input)
  } catch (error) {
    if (error instanceof DocxPdfConvertError && (error.status === 401 || error.status === 403)) {
      throw new Error(
        `The convert worker is reachable but rejected the request (${error.status}).\n`
          + 'DOCX_PDF_CONVERT_SECRET does not match the worker\'s CONVERT_WORKER_SECRET. '
          + 'The URL is right and the worker is up — only the bearer token disagrees.\n'
          + 'Re-pull it rather than retyping it:\n'
          + '  vercel env pull .env.vercel --environment=production\n'
          + '  grep -E \'^DOCX_PDF_CONVERT_(URL|SECRET)=\' .env.vercel > .env.test && rm .env.vercel\n'
          + 'If the pulled value still fails, Vercel and the worker hold different '
          + 'secrets — which would mean production conversion is failing too, and is '
          + 'worth checking before anything else.',
      )
    }
    throw error
  }
}

describe('signature anchors in a real LibreOffice render', () => {
  it.each(cases)('resolves every %s anchor to a usable box on the page', async (_key, { template, input }) => {
    // No `convertDocx` override: this goes through the deployed worker, which is
    // the whole point. NODE_ENV is 'test' under vitest, so renderEngagementAgreement
    // uses the bundled template and needs no database.
    const rendered = await renderThroughWorker(input)
    expect(rendered.pdfBytes.length).toBeGreaterThan(0)

    const markers = allEngagementAnchorMarkers(template.recipientCount)

    let located
    try {
      located = await locateAnchors(rendered.pdfBytes, markers)
    } catch (error) {
      if (error instanceof AnchorLocationError) {
        // The failure code is the entire diagnostic value, so surface it rather
        // than letting the assertion report an opaque rejection.
        throw new Error(
          `locateAnchors failed with code "${error.code}": ${error.message}\n`
            + 'This is the assumption the probe exists to test. A "geometry_unavailable" '
            + 'here means the extractor read the text but not its position in a real '
            + 'render — the signature would have no place to go.',
        )
      }
      throw error
    }

    expect(located.map(a => a.marker).sort()).toEqual([...markers].sort())

    for (const anchor of located) {
      const { marker, page, bbox } = anchor
      const pdfOrigin = toPdfOrigin(bbox, LETTER_HEIGHT)
      console.log(
        `${marker}  page ${page}  `
          + `top-left (${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)}) `
          + `${bbox.width.toFixed(1)}x${bbox.height.toFixed(1)}  `
          + `→ pdf-lib y ${pdfOrigin.y.toFixed(1)}`,
      )

      expect(page, `${marker} page`).toBeGreaterThanOrEqual(1)
      // A zero-sized box would pass a null check and still place nothing.
      expect(bbox.width, `${marker} width`).toBeGreaterThan(0)
      expect(bbox.height, `${marker} height`).toBeGreaterThan(0)
      // On the page, not off it. render.ts already pins every page to US Letter.
      expect(bbox.x, `${marker} x`).toBeGreaterThanOrEqual(0)
      expect(bbox.y, `${marker} y`).toBeGreaterThanOrEqual(0)
      expect(bbox.x + bbox.width, `${marker} right edge`).toBeLessThanOrEqual(LETTER_WIDTH)
      expect(bbox.y + bbox.height, `${marker} bottom edge`).toBeLessThanOrEqual(LETTER_HEIGHT)
      // The flip has to land back on the page too, or the stamp is drawn off it.
      expect(pdfOrigin.y, `${marker} flipped y`).toBeGreaterThanOrEqual(0)
      expect(pdfOrigin.y + pdfOrigin.height, `${marker} flipped top`).toBeLessThanOrEqual(LETTER_HEIGHT)
    }
  })

  it.each(multiSignerCases)('gives each %s signer a distinct position', async (_key, { input }) => {
    // Both signers resolving is not enough: if CLIENT_1 and CLIENT_2 came back
    // at the same spot, one signature would land on the other's line — the same
    // class of defect as the SPOUSE/CLIENT_2 mismatch, arriving geometrically.
    //
    // Distinct means distinct, not "on separate lines". In the shipped template
    // the two signature blocks are a two-column table row, so the signers share
    // a `y` and differ only in `x` — and their dates do the same, one row down.
    // A run that reports both signers at the same `y` is therefore expected
    // here, and is not what this test is looking for.
    const rendered = await renderThroughWorker(input)
    const first = engagementAnchorMarkers(1)
    const second = engagementAnchorMarkers(2)
    const [sig1, date1, sig2, date2] = await locateAnchors(rendered.pdfBytes, [
      first.signature, first.date, second.signature, second.date,
    ])

    const samePlace = (a: typeof sig1, b: typeof sig1) =>
      a.page === b.page && Math.abs(a.bbox.x - b.bbox.x) < 1 && Math.abs(a.bbox.y - b.bbox.y) < 1

    expect(samePlace(sig1, sig2), 'the two signature anchors resolve to the same place').toBe(false)
    expect(samePlace(date1, date2), 'the two date anchors resolve to the same place').toBe(false)
  })
})
