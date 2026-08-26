import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coagentMannerFromServing,
  effectiveDpoaTrustPowers,
  getDesignSheetDpoaProvisions,
  setDesignSheetDpoaProvisions,
} from '@/lib/designSheetDpoaProvisions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import { defaultDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import {
  getWillPersonalRepresentativePowers,
  setWillPersonalRepresentativePowers,
} from '@/lib/designSheetWillPowers'

describe('estate plan design trust selection', () => {
  it('does not default revocable trust inclusion for testamentary trust plans', () => {
    expect(designPlanTypeIncludesRevocableTrust('pour_over')).toBe(true)
    expect(designPlanTypeIncludesRevocableTrust('testamentary_trust')).toBe(false)
    expect(planTypeDisallowsRevocableTrustDocument('testamentary_trust')).toBe(true)
    expect(defaultDocumentInclusions({ plan_type: 'testamentary_trust', marital_status: 'married' }).trust).toBe(false)
    expect(defaultDocumentInclusions({ plan_type: 'pour_over', marital_status: 'married' }).trust).toBe(true)
  })

  it('disables the trust checkbox for testamentary trust plans in Estate Plan Design', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx'),
      'utf8',
    )

    expect(source).toContain('planTypeDisallowsRevocableTrustDocument')
    expect(source).toContain('trustCheckboxDisabled')
    expect(source).toContain('Not available with Will — Testamentary Trust')
  })

  it('keeps the will no-contest control on the same pair of stores as the trust checkbox', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/WillProvisionsSection.tsx'),
      'utf8',
    )

    // The decision is stored twice and toGeneratorData ORs the namespace flag
    // over the column, so a control that reads or writes only the column shows
    // "Omit" on a will that drafts the clause anyway.
    expect(source).toContain(
      "getTrustDetails(sheet).include_no_contest_clause || sheet.no_contest_clause === 'include'",
    )
    expect(source).toContain("setTrustDetails(previous, { include_no_contest_clause: v === 'include' })")
    expect(source).not.toContain("value={sheet.no_contest_clause ?? 'omit'}")
  })
})

describe('will personal representative powers', () => {
  it('stores PR powers in decisions JSONB', () => {
    const decisions = setWillPersonalRepresentativePowers({}, {
      allow_pay_taxes_debts_expenses: true,
      allow_manage_digital_assets: true,
      include_distribution_cash_or_kind: true,
    })

    expect(getWillPersonalRepresentativePowers({ decisions })).toEqual({
      allow_pay_taxes_debts_expenses: true,
      allow_manage_digital_assets: true,
      include_distribution_cash_or_kind: true,
    })
  })

  it('renders the Personal Representative Powers section on the Will page', () => {
    const documentSections = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'),
      'utf8',
    )
    const willPowers = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/WillPersonalRepresentativePowersSection.tsx'),
      'utf8',
    )

    expect(documentSections).toContain('WillPersonalRepresentativePowersSection')
    expect(willPowers).toContain('Allow executor to pay taxes, debts, and expenses')
  })
})

describe('financial power of attorney provisions', () => {
  it('stores expanded DPOA provisions and syncs co-agent serving to legacy manner column', () => {
    const decisions = setDesignSheetDpoaProvisions({}, {
      agent_compensation: 'prevailing_professional',
      coagent_serving: 'jointly',
      allow_gifts: true,
      all_basic_powers: true,
    })

    const provisions = getDesignSheetDpoaProvisions({ decisions, dpoa_coagent_manner: null })
    expect(provisions.agent_compensation).toBe('prevailing_professional')
    expect(provisions.coagent_serving).toBe('jointly')
    expect(provisions.allow_gifts).toBe(true)
    expect(provisions.all_basic_powers).toBe(true)
    expect(coagentMannerFromServing('jointly')).toBe('jointly')
    expect(coagentMannerFromServing('silent')).toBeNull()
  })

  it('renders the expanded Financial POA section', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DpoaProvisionsSection.tsx'),
      'utf8',
    )

    expect(source).toContain('Compensation for Agents')
    expect(source).toContain('Trust Powers')
    expect(source).toContain('Attorney-in-Fact(s) Powers')
    expect(source).toContain('Clause Library')
  })

  it('hides the trust power checkboxes behind the include choice', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DpoaProvisionsSection.tsx'),
      'utf8',
    )

    expect(source).toContain('Include trust powers?')
    expect(source).toContain('{provisions.include_trust_powers && (')
    expect(source.indexOf('Miscellaneous Special Powers')).toBeGreaterThan(source.indexOf('Attorney-in-Fact(s) Powers'))
  })

  it('defaults trust powers to excluded and zeroes the switches when not included', () => {
    const fresh = getDesignSheetDpoaProvisions({ decisions: null })
    expect(fresh.include_trust_powers).toBe(false)

    const decisions = setDesignSheetDpoaProvisions({}, {
      include_trust_powers: true,
      agent_may_create_trusts: true,
      allow_agent_as_trustee: true,
    })
    const included = getDesignSheetDpoaProvisions({ decisions })
    expect(effectiveDpoaTrustPowers(included).agent_may_create_trusts).toBe(true)

    const excludedDecisions = setDesignSheetDpoaProvisions({ decisions }, { include_trust_powers: false })
    const excluded = getDesignSheetDpoaProvisions({ decisions: excludedDecisions })
    // Selections stay on the sheet so re-including restores them, but the document sees none of them.
    expect(excluded.agent_may_create_trusts).toBe(true)
    expect(Object.values(effectiveDpoaTrustPowers(excluded)).every(value => value === false)).toBe(true)
  })

  it('treats trust powers saved before the include choice as included', () => {
    const legacy = getDesignSheetDpoaProvisions({
      decisions: { dpoa_provisions: { agent_may_modify_joint_trusts: true } },
    })

    expect(legacy.include_trust_powers).toBe(true)
    expect(effectiveDpoaTrustPowers(legacy).agent_may_modify_joint_trusts).toBe(true)
  })
})
