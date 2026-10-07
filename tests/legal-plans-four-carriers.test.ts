import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_PLAN_OPTIONS,
  MATTER_BILLING_TYPES,
  legalPlanDisplayName,
  normalizeMatterBillingType,
} from '@/lib/billing/billingType'
import { billingPlans } from '@/lib/billing/types'
import { PLAN_FEE_SCHEDULES } from '@/lib/billing/planFeeSchedules'
import {
  ARAG_SCHEDULE_ITEMS,
  aragBenefitClaimFeeCents,
  aragProbateFeeCents,
  calculateAragScheduleAmount,
} from '@/lib/arag/pricing'

/**
 * The firm takes four legal plans: MetLife, LegalEASE, ARAG and CLC. These pin
 * that list in the app and the database, that the SQL functions restated for
 * it changed nothing but the list, and the ARAG fee schedule arithmetic.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const MIGRATION = read('supabase/migrations/20270129090000_legal_plans_metlife_legalease_arag_clc.sql')

describe('the four plans', () => {
  it('are the billing types, the carriers and the lead rail options', () => {
    expect([...MATTER_BILLING_TYPES]).toEqual(['flat_fee', 'metlife', 'legalease', 'arag', 'clc', 'other_legal_plan'])
    expect([...billingPlans]).toEqual(['metlife', 'legalease', 'arag', 'clc'])
    expect(LEGAL_PLAN_OPTIONS.map(option => option.label)).toEqual(['MetLife', 'LegalEASE', 'ARAG', 'CLC', 'Other legal plan'])
  })

  it('reads CLC, and reads Hyatt or LegalShield text as some other plan', () => {
    expect(normalizeMatterBillingType('CLC')).toBe('clc')
    expect(legalPlanDisplayName('clc')).toBe('CLC')
    expect(normalizeMatterBillingType('Hyatt Legal Plans')).toBe('other_legal_plan')
    expect(normalizeMatterBillingType('LegalShield')).toBe('other_legal_plan')
    // "clc" inside another word is not CLC.
    expect(normalizeMatterBillingType('cyclclub')).toBeNull()
  })

  it('names no removed plan anywhere the app or the assistant offers one', () => {
    // lib/billing/billingType.ts still reads old text naming them, on purpose.
    for (const file of [
      'lib/billing/types.ts',
      'lib/engagement/types.ts',
      'lib/leads/score.ts',
      'lib/designMeeting/formSpec.ts',
      'tools/workflows/system/assistant/pmps-proposal-preflight/SKILL.md',
    ]) {
      const source = read(file).replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')
      expect(source, file).not.toMatch(/hyatt|legalshield|legal shield/i)
    }
  })
})

describe('the migration', () => {
  const PLANS = "'flat_fee', 'metlife', 'legalease', 'arag', 'clc', 'other_legal_plan'"

  it('narrows every check to the four plans', () => {
    expect(MIGRATION).toContain('add constraint matter_details_billing_type_check')
    expect(MIGRATION).toContain('add constraint client_intake_billing_type_check')
    expect(MIGRATION.split(`billing_type in (\n      ${PLANS}\n    )`)).toHaveLength(3)
    expect(MIGRATION).toContain("check (plan is null or plan in ('metlife', 'legalease', 'arag', 'clc'))")
    expect(MIGRATION).toContain("check (payer in ('client', 'metlife', 'legalease', 'arag', 'clc'))")
    expect(MIGRATION).toContain("notify pgrst, 'reload schema'")
  })

  it('changes no existing row', () => {
    const statements = MIGRATION.replace(/\$\$[\s\S]*?\$\$/g, '')
    expect(statements).not.toMatch(/\b(update|insert\s+into|delete\s+from)\s+(public\.)?\w+/i)
  })

  /**
   * Put the removed plans back in place of CLC and each function must be its
   * live definition byte for byte, so nothing else in those long bodies moved.
   */
  it('restates each function verbatim apart from the plan list', () => {
    const fn = (sql: string, name: string) => {
      const start = sql.indexOf(`create or replace function public.${name}(`)
      expect(start, name).toBeGreaterThanOrEqual(0)
      return sql.slice(start, sql.indexOf('\n$$;', start) + 4)
    }
    const asBefore = (body: string) => body
      .replace(PLANS, "'flat_fee', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan'")
      .replace("('metlife', 'legalease', 'arag', 'clc', 'other_legal_plan')", "('metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan')")
      .replace("'%arag%', '%clc%', '%other_legal_plan%'", "'%arag%', '%hyatt%', '%legalshield%', '%other_legal_plan%'")
      .replace("    when 'clc'              then 'CLC'\n", "    when 'hyatt'            then 'Hyatt'\n    when 'legalshield'      then 'LegalShield'\n")
    for (const [name, live] of [
      ['legal_plan_display_name', '20260908000000_lead_legal_plan_billing.sql'],
      ['update_lead_opportunity_field', '20270127090000_trust_administration_practice_area.sql'],
      ['update_lead_opportunity_details', '20260917000000_convert_preserves_matter_edits.sql'],
      ['lead_score', '20261014000000_lead_list_ranking.sql'],
    ] as const) {
      const restated = fn(MIGRATION, name)
      expect(restated, name).not.toMatch(/hyatt|legalshield/)
      expect(asBefore(restated), name).toBe(fn(read(`supabase/migrations/${live}`), name))
    }
  })

  it('is the newest definition of each function', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
    for (const name of ['legal_plan_display_name', 'update_lead_opportunity_field', 'update_lead_opportunity_details', 'lead_score']) {
      const newest = files.filter(file => read(`supabase/migrations/${file}`).includes(`function public.${name}(`)).at(-1)
      expect(newest, name).toBe('20270129090000_legal_plans_metlife_legalease_arag_clc.sql')
    }
  })
})

describe('the ARAG fee schedule', () => {
  const item = (key: string) => ARAG_SCHEDULE_ITEMS.find(candidate => candidate.key === key)!

  it('has unique keys and a price or a rule for every row', () => {
    const keys = ARAG_SCHEDULE_ITEMS.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of ARAG_SCHEDULE_ITEMS) {
      expect(entry.amountCents !== undefined || entry.input !== undefined, entry.key).toBe(true)
    }
  })

  it('prices the estate planning packages as the 2026 schedule does', () => {
    expect(item('will_individual').amountCents).toBe(38_000)
    expect(item('will_combined').amountCents).toBe(45_500)
    expect(item('trust_individual').amountCents).toBe(39_000)
    expect(item('trust_combined').amountCents).toBe(49_500)
    expect(item('trust_amendment').amountCents).toBe(15_000)
    expect(item('trust_funding').amountCents).toBe(25_000)
    expect(item('initial_consultation').amountCents).toBe(2_500)
  })

  it('pays paid-in-full probate at 1.25% of assets, between $1,000 and $4,000', () => {
    expect(aragProbateFeeCents(0)).toBe(100_000)
    expect(aragProbateFeeCents(5_000_000)).toBe(100_000)
    expect(aragProbateFeeCents(20_000_000)).toBe(250_000)
    expect(aragProbateFeeCents(32_000_000)).toBe(400_000)
    expect(aragProbateFeeCents(100_000_000)).toBe(400_000)
    expect(aragProbateFeeCents(-1)).toBeNull()
    expect(calculateAragScheduleAmount(item('probate_paid_in_full'), 200_000)).toBe(250_000)
    expect(calculateAragScheduleAmount(item('probate_paid_in_full'))).toBeNull()
  })

  it('pays hourly plans at $100 an hour', () => {
    expect(calculateAragScheduleAmount(item('probate_hourly'), 7.5)).toBe(75_000)
    expect(calculateAragScheduleAmount(item('general_hourly'), 0.3)).toBe(3_000)
  })

  it('pays documents per document up to the cap, and only for whole documents', () => {
    expect(calculateAragScheduleAmount(item('doc_deed'), 1)).toBe(5_500)
    expect(calculateAragScheduleAmount(item('doc_deed'), 5)).toBe(27_500)
    expect(calculateAragScheduleAmount(item('doc_deed'), 9)).toBe(27_500)
    expect(calculateAragScheduleAmount(item('doc_poa_couple'), 2)).toBe(20_000)
    expect(calculateAragScheduleAmount(item('doc_hipaa'), 4)).toBe(16_500)
    expect(calculateAragScheduleAmount(item('doc_deed'), 1.5)).toBeNull()
    expect(calculateAragScheduleAmount(item('doc_deed'), 0)).toBeNull()
  })

  it('pays a benefits hearing 20% of the claim, up to $1,000', () => {
    expect(aragBenefitClaimFeeCents(300_000)).toBe(60_000)
    expect(aragBenefitClaimFeeCents(900_000)).toBe(100_000)
  })

  it('is offered in the Add charge dialog for ARAG and MetLife claims only', () => {
    expect(Object.keys(PLAN_FEE_SCHEDULES).sort()).toEqual(['arag', 'metlife'])
    const arag = PLAN_FEE_SCHEDULES.arag!
    expect(arag.pickerLabel).toBe('ARAG fee schedule item')
    expect(arag.entries.find(entry => entry.key === 'trust_combined')?.label).toBe('ARAG Trusts — Combined trust — Member and Spouse/Partner')
    expect(arag.amountCents('trust_combined')).toBe(49_500)
    expect(arag.entries.find(entry => entry.key === 'doc_deed')?.input?.step).toBe('1')
  })
})
