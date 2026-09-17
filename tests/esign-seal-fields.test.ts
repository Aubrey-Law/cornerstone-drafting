import { describe, expect, it } from 'vitest'
import { formatSigningDate, sealFieldsFor, type SignedMark } from '@/lib/esign/sealFields'

/**
 * The first real two-party agreement was executed with only the last signer's
 * marks on it. Each signature rebuilt the sealed file from the approved PDF and
 * stamped one signer, so the primary's seal erased the spouse's — the executed
 * document carried a drawn signature on one line and a literal
 * `[[CLIENT_2_SIGNATURE]]` on the other.
 *
 * Rebuilding from the original is correct and deliberate: it keeps exactly one
 * audit certificate on the file. Rebuilding it with one signer is the defect.
 * These pin the difference.
 */

/** The firm's own zone, as `getSchedulingSettings().timezone` reports it. */
const FIRM_TZ = 'America/New_York'

const spouseTyped: SignedMark = {
  position: 2,
  signedAt: new Date('2026-09-16T01:41:55Z'),
  typedName: 'Skylar White',
}

const primaryDrawn: SignedMark = {
  position: 1,
  signedAt: new Date('2026-09-16T01:43:20Z'),
  signaturePng: Buffer.from('fake-png'),
}

describe('formatSigningDate', () => {
  it('renders in the zone it is given, never the one the machine is set to', () => {
    // 01:43:20Z is 9:43pm on the 15th in New York and 1:43am on the 16th in
    // UTC. Which day gets written onto the signature line of an executed legal
    // document therefore depends entirely on the zone — and with no `timeZone`
    // passed to toLocaleDateString it is whichever zone the machine doing the
    // sealing happens to be set to. That made this file pass on a UTC CI runner
    // and fail on a US developer's laptop, which was the visible symptom; the
    // defect underneath is that the stamped date was never the firm's to begin
    // with.
    //
    // Asserting two zones at once is what makes the guarantee enforceable. A
    // single expectation can only fail on machines whose ambient zone happens
    // to disagree with it, so it would trade a laptop-only failure for a
    // CI-only one. These two disagree with each other, so dropping the
    // `timeZone` option collapses them onto one answer and fails here on every
    // machine, in every zone.
    const instant = new Date('2026-09-16T01:43:20Z')

    expect(formatSigningDate(instant, 'America/New_York')).toBe('September 15, 2026')
    expect(formatSigningDate(instant, 'UTC')).toBe('September 16, 2026')
  })
})

describe('sealFieldsFor', () => {
  it('stamps every signer, not only the most recent one', () => {
    const fields = sealFieldsFor([spouseTyped, primaryDrawn], FIRM_TZ)

    expect(fields.map(f => f.marker)).toEqual([
      '[[CLIENT_1_SIGNATURE]]',
      '[[CLIENT_1_DATE]]',
      '[[CLIENT_2_SIGNATURE]]',
      '[[CLIENT_2_DATE]]',
    ])
  })

  it('numbers markers by position, so the spouse is CLIENT_2', () => {
    // Never by role. A role-named prefix produced [[SPOUSE_SIGNATURE]], which
    // exists in no template — see tests/engagement-anchors.test.ts.
    const fields = sealFieldsFor([spouseTyped], FIRM_TZ)

    expect(fields.map(f => f.marker)).toEqual(['[[CLIENT_2_SIGNATURE]]', '[[CLIENT_2_DATE]]'])
  })

  it('gives each signer their own signing date', () => {
    // Re-stamping an earlier signer with "now" would quietly move the date on a
    // line they already signed. Separate days, because the incident's two
    // signatures fell on the same date and could not show the difference.
    const fields = sealFieldsFor([
      { ...spouseTyped, signedAt: new Date('2026-09-14T09:00:00Z') },
      { ...primaryDrawn, signedAt: new Date('2026-09-16T01:43:20Z') },
    ], FIRM_TZ)
    const dates = fields.filter(f => f.kind === 'date')

    // 9:43pm on the 15th in the firm's zone — not the 16th, which is only the
    // date this instant carries in UTC.
    expect(dates[0].text).toBe('September 15, 2026')
    expect(dates[1].text).toBe('September 14, 2026')
  })

  it('stamps in the zone it is handed, rather than reaching for an ambient one', () => {
    // formatSigningDate owns the rendering; this pins that sealFieldsFor
    // actually threads the zone through to it. Two zones for the same instant,
    // for the same reason as above: one expectation could not fail everywhere.
    const marks = [{ ...primaryDrawn, signedAt: new Date('2026-09-16T01:43:20Z') }]

    const newYork = sealFieldsFor(marks, 'America/New_York').filter(f => f.kind === 'date')
    const utc = sealFieldsFor(marks, 'UTC').filter(f => f.kind === 'date')

    expect(newYork[0].text).toBe('September 15, 2026')
    expect(utc[0].text).toBe('September 16, 2026')
  })

  it('carries a drawing as bytes and a typed name as text', () => {
    const [primarySig, , spouseSig] = sealFieldsFor([spouseTyped, primaryDrawn], FIRM_TZ)

    expect(primarySig.signaturePng).toEqual(primaryDrawn.signaturePng)
    expect(primarySig.text).toBeUndefined()
    expect(spouseSig.text).toBe('Skylar White')
    expect(spouseSig.signaturePng).toBeUndefined()
  })

  it('orders by position regardless of the order people signed in', () => {
    const signedSpouseFirst = sealFieldsFor([spouseTyped, primaryDrawn], FIRM_TZ)
    const signedPrimaryFirst = sealFieldsFor([primaryDrawn, spouseTyped], FIRM_TZ)

    expect(signedPrimaryFirst).toEqual(signedSpouseFirst)
  })

  it('refuses a signer with neither a drawing nor a name', () => {
    // stampField would paint a white rectangle over the marker and return,
    // leaving a blank line on a document that reads as executed.
    expect(() => sealFieldsFor([{ position: 1, signedAt: new Date(), typedName: '  ' }], FIRM_TZ))
      .toThrow(/neither a drawn signature nor a typed name/i)
  })

  it('refuses two signers claiming the same line', () => {
    expect(() => sealFieldsFor([primaryDrawn, { ...spouseTyped, position: 1 }], FIRM_TZ))
      .toThrow(/position 1/i)
  })
})
