import { describe, expect, it } from 'vitest'
import { applyDesignPlanType } from '@/lib/designSheet/applyPlanType'
import type { DesignSheet } from '@/types/database'

function sheet(overrides: Partial<DesignSheet> = {}): Pick<DesignSheet, 'plan_type' | 'decisions' | 'marital_status'> {
  return {
    plan_type: 'pour_over',
    marital_status: 'married',
    decisions: { document_inclusions: { trust: true } },
    ...overrides,
  }
}

describe('applyDesignPlanType', () => {
  it('turns the revocable trust off for a testamentary will', () => {
    const applied = applyDesignPlanType(sheet(), 'testamentary_trust')
    expect(applied.planType).toBe('testamentary_trust')
    expect(applied.decisions).toMatchObject({
      document_inclusions: { trust: false },
      estate_plan_design: { trust: false, will_title: 'last_will' },
    })
  })

  it('turns the revocable trust on when a pour-over plan had it off', () => {
    const applied = applyDesignPlanType(
      sheet({
        plan_type: 'testamentary_trust',
        decisions: { document_inclusions: { trust: false } },
      }),
      'pour_over',
    )
    expect(applied.decisions).toMatchObject({
      document_inclusions: { trust: true },
      estate_plan_design: { trust: true, will_title: 'pour_over_will' },
    })
  })

  it('leaves decisions alone when the package already matches the plan', () => {
    expect(applyDesignPlanType(sheet(), 'pour_over').decisions).toBeNull()
    expect(applyDesignPlanType(sheet({ plan_type: 'outright_will', decisions: {} }), 'outright_will').decisions).toBeNull()
  })

  it('does not rewrite trust inclusions for an outright will', () => {
    expect(applyDesignPlanType(sheet(), 'outright_will').decisions).toBeNull()
  })
})
