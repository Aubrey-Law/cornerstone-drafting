import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coagentMannerFromServing,
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
})
