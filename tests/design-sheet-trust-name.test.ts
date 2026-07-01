import { describe, expect, it } from 'vitest'

import {
  deriveTrustName,
  deriveSpouseTrustName,
  computeDesignSheetDefaults,
} from '@/lib/designSheetDefaults'
import type { DesignSheet, PipelineMatter } from '@/types/database'

const matter = { client_name: 'John David Smith', spouse_name: 'Margaret Anne Smith' } as PipelineMatter

function sheetWith(overrides: Partial<DesignSheet>): DesignSheet {
  return {
    client_name: 'John David Smith',
    spouse_name: 'Margaret Anne Smith',
    marital_status: 'Married',
    is_joint: false,
    state: 'MA',
    client_citizenship: null,
    spouse_citizenship: null,
    client_domicile: null,
    trust_name: null,
    spouse_trust_name: null,
    ...overrides,
  } as DesignSheet
}

describe('design sheet trust name autofill', () => {
  it('derives the client trust name from initials when not joint', () => {
    expect(deriveTrustName(sheetWith({ is_joint: false }), matter)).toBe('The JDS Trust')
  })

  it('derives the spouse trust name from spouse initials', () => {
    expect(deriveSpouseTrustName(sheetWith({}), matter)).toBe('The MAS Trust')
  })

  it('derives a family trust name from the client last name when joint', () => {
    expect(deriveTrustName(sheetWith({ is_joint: true }), matter)).toBe('Smith Family Trust')
  })

  it('falls back to the matter name when the sheet has no client name', () => {
    expect(deriveTrustName(sheetWith({ client_name: null }), matter)).toBe('The JDS Trust')
  })

  it('returns an empty string when no name is available', () => {
    const empty = { client_name: null, spouse_name: null } as unknown as PipelineMatter
    expect(deriveTrustName(sheetWith({ client_name: null }), empty)).toBe('')
    expect(deriveSpouseTrustName(sheetWith({ spouse_name: null }), empty)).toBe('')
  })
})

describe('computeDesignSheetDefaults', () => {
  it('fills citizenship, domicile, and trust names for a married separate-trust couple', () => {
    expect(computeDesignSheetDefaults(sheetWith({ is_joint: false }), matter)).toEqual({
      client_citizenship: 'US Citizen',
      spouse_citizenship: 'US Citizen',
      client_domicile: 'MA',
      trust_name: 'The JDS Trust',
      spouse_trust_name: 'The MAS Trust',
    })
  })

  it('uses a single family trust name and omits spouse trust when joint', () => {
    expect(computeDesignSheetDefaults(sheetWith({ is_joint: true }), matter)).toEqual({
      client_citizenship: 'US Citizen',
      spouse_citizenship: 'US Citizen',
      client_domicile: 'MA',
      trust_name: 'Smith Family Trust',
    })
  })

  it('omits spouse fields when unmarried', () => {
    expect(
      computeDesignSheetDefaults(sheetWith({ marital_status: 'Single', spouse_name: null }), matter),
    ).toEqual({
      client_citizenship: 'US Citizen',
      client_domicile: 'MA',
      trust_name: 'The JDS Trust',
    })
  })

  it('never overwrites attorney-entered values', () => {
    const patch = computeDesignSheetDefaults(
      sheetWith({
        client_citizenship: 'Permanent Resident',
        spouse_citizenship: 'US Citizen',
        client_domicile: 'NH',
        trust_name: 'The Custom Family Trust',
        spouse_trust_name: 'The Spouse Custom Trust',
      }),
      matter,
    )
    expect(patch).toEqual({})
  })

  it('skips domicile when no state is known', () => {
    const patch = computeDesignSheetDefaults(sheetWith({ state: null }), matter)
    expect(patch).not.toHaveProperty('client_domicile')
  })
})
