import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  BYPASS_TRUST_FORMULAS,
  BYPASS_TRUST_TYPES,
  MARITAL_TRUST_TYPES,
  buildSpouseTrustNameSuggestions,
  buildStaggeredTiersFromPreset,
  buildTrustNameSuggestions,
  createsBypassTrust,
  createsMaritalTrust,
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
    expect(trustDetailsSource).toContain('Distribute in Trust')
    expect(trustDetailsSource).toContain('Clayton Election')
    expect(trustDetailsSource).toContain("setTrustPlanningType(prevSheet, value)")
  })

  it('renders the marital and bypass options for joint and separate trusts alike', () => {
    // A joint trust always shows them; a separate trust only once the residuary
    // is actually held in trust for the spouse.
    expect(trustDetailsSource).toContain('{jointTrust && <MaritalBypassTrustOptions sheet={sheet} onChange={onChange} variant="joint" />}')
    expect(trustDetailsSource).toContain('{spouseTrustsFromResiduary && (')
    expect(trustDetailsSource).toContain("spousalFunding !== 'outright_to_spouse' && spousalFunding !== 'not_to_spouse'")
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

  it('resolves from trust_details only, normalising legacy spellings', () => {
    expect(resolveResidualBeneficiaryMethod({
      decisions: { trust_details: { residual_beneficiary_method: 'trust-for-life' } },
    } as never)).toBe('trust_for_life')

    expect(resolveResidualBeneficiaryMethod({
      decisions: { trust_details: { residual_beneficiary_method: 'per stirpes' } },
    } as never)).toBeNull()

    expect(resolveResidualBeneficiaryMethod({ decisions: {} } as never)).toBeNull()
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

  it('anchors the readiness blocker to the rendered field', () => {
    // designSheetReadiness targets `residual_beneficiary_method`, which resolves to
    // id="design-field-residual_beneficiary_method".
    expect(source).toContain('fieldName="residual_beneficiary_method"')
  })
})

describe('trust details — Phase 0 defects', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
    'utf8',
  )

  it('wires the marital deduction checkbox to a stored field instead of a dead handler', () => {
    // It used to render `checked={false} onChange={() => {}}` — clickable, inert.
    expect(source).not.toContain('onChange={() => {}}')
    expect(source).toContain('checked={trustDetails.include_marital_deduction_savings_language}')
    expect(source).toContain('include_marital_deduction_savings_language: checked')
  })

  it('gives the stored initial-trustee nomination an input', () => {
    expect(source).toContain('fieldName="initial_trustee_nomination"')
    expect(source).toContain('fieldName="spouse_initial_trustee_nomination"')
  })

  it('reads the new marital deduction field back, defaulting to undecided-as-off', () => {
    expect(getTrustDetails({ decisions: null }).include_marital_deduction_savings_language).toBe(false)
    expect(
      getTrustDetails({
        decisions: { trust_details: { include_marital_deduction_savings_language: true } },
      }).include_marital_deduction_savings_language,
    ).toBe(true)
  })
})

describe('marital and bypass trust options', () => {
  const optionsSource = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/MaritalBypassTrustOptions.tsx'),
    'utf8',
  )

  it('offers both variants of every question', () => {
    expect(optionsSource).toContain('Qualified Terminable Interest Property Trust (QTIP)')
    expect(optionsSource).toContain('General Power of Appointment Trust')
    expect(optionsSource).toContain('Marital Trust Invasion Powers')
    expect(optionsSource).toContain('QTIP Remainder Power of Appointment')
    expect(optionsSource).toContain('Include QDOT Language')
    // Joint wording and separate wording for the same two stored values.
    expect(optionsSource).toContain('Bypass Trust (A/B)')
    expect(optionsSource).toContain('Bypass/Credit-Shelter Trust')
    expect(optionsSource).toContain('Contingent Disclaimer Trust')
    expect(optionsSource).toContain('Bypass Trust Formula')
    expect(optionsSource).toContain('Bypass Trust Power of Appointment')
  })

  it('defaults every marital and bypass answer to undecided', () => {
    const details = getTrustDetails({ decisions: null })
    expect(details.marital_trust).toBeNull()
    expect(details.marital_trust_invasion).toBeNull()
    expect(details.marital_trust_remainder_power).toBeNull()
    expect(details.marital_trust_include_qdot).toBe(false)
    expect(details.bypass_trust).toBeNull()
    expect(details.bypass_trust_formula).toBeNull()
    expect(details.bypass_trust_fixed_amount).toBeNull()
    expect(details.bypass_trust_percentage).toBeNull()
    expect(details.bypass_trust_remainder_power).toBeNull()
    expect(details.bypass_trust_allow_sprinkling).toBe(false)
  })

  it('reads stored answers back and rejects values outside the option lists', () => {
    const stored = getTrustDetails({
      decisions: {
        trust_details: {
          marital_trust: 'qtip',
          bypass_trust: 'disclaimer',
          bypass_trust_percentage: 45,
        },
      },
    })
    expect(stored.marital_trust).toBe('qtip')
    expect(stored.bypass_trust).toBe('disclaimer')
    expect(stored.bypass_trust_percentage).toBe(45)

    // A renamed or hand-edited option reads as undecided rather than smuggling
    // a bogus enum into a template comparison that would never match.
    const bogus = getTrustDetails({
      decisions: { trust_details: { marital_trust: 'bypass_ab', bypass_trust_formula: 'whatever' } },
    })
    expect(bogus.marital_trust).toBeNull()
    expect(bogus.bypass_trust_formula).toBeNull()
  })

  it('tells which answers actually create a trust', () => {
    expect(MARITAL_TRUST_TYPES.filter(createsMaritalTrust))
      .toEqual(['general_power_of_appointment', 'qtip'])
    expect(BYPASS_TRUST_TYPES.filter(createsBypassTrust)).toEqual(['bypass', 'disclaimer'])
    expect(createsMaritalTrust(null)).toBe(false)
    expect(createsBypassTrust(null)).toBe(false)
  })

  it('keeps every formula option reachable from the option map', () => {
    for (const value of BYPASS_TRUST_FORMULAS) {
      expect(optionsSource).toContain(`${value}: {`)
    }
  })
})
