import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildSpouseTrustNameSuggestions,
  buildStaggeredTiersFromPreset,
  buildTrustNameSuggestions,
  getTrustDetails,
  normalizeResidualBeneficiaryMethod,
  resolveResidualBeneficiaryMethod,
  RESIDUAL_BENEFICIARY_METHODS,
  STAGGERED_DISTRIBUTION_PRESETS,
} from '@/lib/designSheetTrustDetails'

describe('trust details design section', () => {
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('exposes spousal trust funding options in Trust Structure', () => {
    expect(trustDetailsSource).toContain('Spousal Trust Funding')
    expect(trustDetailsSource).toContain('Outright to Spouse')
    expect(trustDetailsSource).toContain('Clayton Election')
    expect(trustDetailsSource).toContain("setTrustPlanningType(prevSheet, value)")
  })

  it('includes trust name quick-fill suggestions and format controls', () => {
    expect(trustDetailsSource).toContain('buildTrustNameSuggestions')
    expect(trustDetailsSource).toContain('Trust Name Format')
    expect(trustDetailsSource).toContain('Append "and any amendments thereto"')
    expect(trustDetailsSource).toContain("scope=\"spouse\"")
  })

  it('captures trustee provisions, residuary, administrative, and definition options', () => {
    expect(trustDetailsSource).not.toContain('Initial Trustee Nomination Structure')
    expect(trustDetailsSource).toContain('Successor Trustee Vacancy')
    expect(trustDetailsSource).toContain('Residual Beneficiary Method')
    expect(trustDetailsSource).toContain('Special Distributions')
    expect(trustDetailsSource).toContain('Administrative Provisions')
    expect(trustDetailsSource).toContain('Definitions')
    expect(trustDetailsSource).toContain('Protect U.S. trust status')
  })

  it('builds joint and separate trust name suggestions', () => {
    expect(buildTrustNameSuggestions(
      { client_name: 'John David Smith', spouse_name: 'Jane Smith', is_joint: true },
      { client_name: 'John David Smith', spouse_name: 'Jane Smith' },
    )).toEqual([
      'The Smith Family Trust',
      'The John David Smith and Jane Smith Trust',
    ])

    expect(buildTrustNameSuggestions(
      { client_name: 'John David Smith', spouse_name: null, is_joint: false },
      { client_name: 'John David Smith', spouse_name: null },
    )).toEqual([
      'The John David Smith Trust',
      'The JDS Trust',
    ])
  })

  it('builds spouse separate trust name suggestions from full name and initials', () => {
    expect(buildSpouseTrustNameSuggestions(
      { spouse_name: 'Jane Ann Smith' },
      { spouse_name: 'Jane Ann Smith' },
    )).toEqual([
      'The Jane Ann Smith Trust',
      'The JAS Trust',
    ])
  })

  it('defaults trust detail provisions from decisions JSONB', () => {
    expect(getTrustDetails({ decisions: null }).initial_trustee_nomination).toBe('grantor')
    expect(getTrustDetails({ decisions: null }).trustee_compensation).toBe('reasonable')
  })
})

describe('staggered distribution quick fill', () => {
  const trustDetailsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('offers the three standard presets', () => {
    expect(STAGGERED_DISTRIBUTION_PRESETS.map(p => p.label)).toEqual([
      'All at 30',
      '1/2 at 25 and 30',
      '1/3 at 25, 30, 35',
    ])
    expect(STAGGERED_DISTRIBUTION_PRESETS[0].tiers).toEqual([{ amount: 'All', age: 30 }])
    expect(STAGGERED_DISTRIBUTION_PRESETS[1].tiers).toEqual([
      { amount: '1/2', age: 25 },
      { amount: '1/2', age: 30 },
    ])
    expect(STAGGERED_DISTRIBUTION_PRESETS[2].tiers).toEqual([
      { amount: '1/3', age: 25 },
      { amount: '1/3', age: 30 },
      { amount: '1/3', age: 35 },
    ])
  })

  it('builds tiers with fresh ids from a preset', () => {
    let n = 0
    const tiers = buildStaggeredTiersFromPreset(STAGGERED_DISTRIBUTION_PRESETS[2], () => `id-${n++}`)
    expect(tiers).toEqual([
      { id: 'id-0', amount: '1/3', age: 25 },
      { id: 'id-1', amount: '1/3', age: 30 },
      { id: 'id-2', amount: '1/3', age: 35 },
    ])
  })

  it('renders the quick fill controls in the staggered distributions editor', () => {
    expect(trustDetailsSource).toContain('Quick fill:')
    expect(trustDetailsSource).toContain('STAGGERED_DISTRIBUTION_PRESETS.map')
    expect(trustDetailsSource).toContain('buildStaggeredTiersFromPreset(preset')
  })
})

// Regression: the design sheet's option value was `trust-for-life` while the union is
// `trust_for_life`, and an `as ResidualBeneficiaryMethod` cast at the change handler
// hid it. Sheets written then still carry the hyphen, and without normalisation a
// lifetime trust resolved as a staged distribution.
describe('residual beneficiary method normalisation', () => {
  it('accepts the canonical values', () => {
    for (const method of RESIDUAL_BENEFICIARY_METHODS) {
      expect(normalizeResidualBeneficiaryMethod(method)).toBe(method)
    }
  })

  it('folds the legacy hyphenated spelling', () => {
    expect(normalizeResidualBeneficiaryMethod('trust-for-life')).toBe('trust_for_life')
  })

  it('rejects anything that is not a method', () => {
    expect(normalizeResidualBeneficiaryMethod('per stirpes')).toBeNull()
    expect(normalizeResidualBeneficiaryMethod('')).toBeNull()
    expect(normalizeResidualBeneficiaryMethod(null)).toBeNull()
    expect(normalizeResidualBeneficiaryMethod(42)).toBeNull()
  })

  it('normalises a legacy value stored in trust_details', () => {
    const sheet = { decisions: { trust_details: { residual_beneficiary_method: 'trust-for-life' } } }
    expect(getTrustDetails(sheet as never).residual_beneficiary_method).toBe('trust_for_life')
  })

  it('resolves trust_details ahead of the column, normalising either', () => {
    expect(resolveResidualBeneficiaryMethod({
      decisions: { trust_details: { residual_beneficiary_method: 'outright' } },
      distribution_method: 'staggered',
    } as never)).toBe('outright')

    expect(resolveResidualBeneficiaryMethod({
      decisions: {},
      distribution_method: 'trust-for-life',
    } as never)).toBe('trust_for_life')

    expect(resolveResidualBeneficiaryMethod({
      decisions: {},
      distribution_method: 'per stirpes',
    } as never)).toBeNull()
  })
})

// Regression: the section wrote the residual beneficiary method to both
// decisions.trust_details and the `distribution_method` column, and the two drifted
// — some live sheets carry a column value with no trust_details entry. trust_details
// is now the only written home; the column is read-only legacy.
describe('residual beneficiary method has a single writer', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('writes only trust_details when the method changes', () => {
    expect(source).toContain("updateTrustDetails({ residual_beneficiary_method: method })")
    expect(source).not.toContain("onChange('distribution_method'")
  })

  it('still anchors the readiness blocker to the rendered field', () => {
    // designSheetReadiness targets `distribution_method`, which resolves to
    // id="design-field-distribution_method" — the column name outlives the write.
    expect(source).toContain('fieldName="distribution_method"')
  })

  it('resolves a legacy column-only sheet', () => {
    expect(resolveResidualBeneficiaryMethod({
      decisions: { trust_details: {} },
      distribution_method: 'staggered',
    } as never)).toBe('staggered')
  })
})
