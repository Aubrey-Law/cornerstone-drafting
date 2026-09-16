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

describe('sealFieldsFor', () => {
  it('stamps every signer, not only the most recent one', () => {
    const fields = sealFieldsFor([spouseTyped, primaryDrawn])

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
    const fields = sealFieldsFor([spouseTyped])

    expect(fields.map(f => f.marker)).toEqual(['[[CLIENT_2_SIGNATURE]]', '[[CLIENT_2_DATE]]'])
  })

  it('gives each signer their own signing date', () => {
    // Re-stamping an earlier signer with "now" would quietly move the date on a
    // line they already signed. Separate days, because the incident's two
    // signatures fell on the same date and could not show the difference.
    const fields = sealFieldsFor([
      { ...spouseTyped, signedAt: new Date('2026-09-14T09:00:00Z') },
      { ...primaryDrawn, signedAt: new Date('2026-09-16T01:43:20Z') },
    ])
    const dates = fields.filter(f => f.kind === 'date')

    expect(dates[0].text).toBe('September 16, 2026')
    expect(dates[1].text).toBe('September 14, 2026')
  })

  it('carries a drawing as bytes and a typed name as text', () => {
    const [primarySig, , spouseSig] = sealFieldsFor([spouseTyped, primaryDrawn])

    expect(primarySig.signaturePng).toEqual(primaryDrawn.signaturePng)
    expect(primarySig.text).toBeUndefined()
    expect(spouseSig.text).toBe('Skylar White')
    expect(spouseSig.signaturePng).toBeUndefined()
  })

  it('orders by position regardless of the order people signed in', () => {
    const signedSpouseFirst = sealFieldsFor([spouseTyped, primaryDrawn])
    const signedPrimaryFirst = sealFieldsFor([primaryDrawn, spouseTyped])

    expect(signedPrimaryFirst).toEqual(signedSpouseFirst)
  })

  it('refuses a signer with neither a drawing nor a name', () => {
    // stampField would paint a white rectangle over the marker and return,
    // leaving a blank line on a document that reads as executed.
    expect(() => sealFieldsFor([{ position: 1, signedAt: new Date(), typedName: '  ' }]))
      .toThrow(/neither a drawn signature nor a typed name/i)
  })

  it('refuses two signers claiming the same line', () => {
    expect(() => sealFieldsFor([primaryDrawn, { ...spouseTyped, position: 1 }]))
      .toThrow(/position 1/i)
  })
})
