import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { LEGAL_PLAN_OPTIONS } from '@/lib/billing/billingType'
import {
  LEAD_FIELD_GROUPS,
  leadFieldApplies,
  leadFieldDefinition,
} from '@/lib/leads/fieldDefinitions'
import { computeLeadReadiness } from '@/lib/leads/readiness'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260908000000_lead_legal_plan_billing.sql'),
  'utf8',
)

const PLAN_KEYS = ['legalPlan', 'legalPlanMemberId', 'legalPlanServiceStart', 'legalPlanServiceEnd'] as const

function lead(overrides: Partial<LeadDetailRecord> = {}): LeadDetailRecord {
  return {
    id: 'lead-1',
    first_name: 'Jane',
    middle_name: null,
    last_name: 'Doe',
    preferred_name: null,
    full_name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '617-555-0100',
    date_of_birth: '1980-04-03',
    address_line1: '10 Main St',
    address_line2: null,
    city: 'Boston',
    state: 'MA',
    zip: '02108',
    county: 'Suffolk',
    marital_status: 'single',
    practice_area: 'EP',
    lead_source: 'Referral',
    lead_status: 'lead',
    engagement_fee_quoted: 4500,
    ...overrides,
  }
}

describe('legal plan field group', () => {
  it('is its own rail section holding exactly the four plan fields', () => {
    const group = LEAD_FIELD_GROUPS.find(entry => entry.title === 'Legal plan')
    expect(group?.keys).toEqual(PLAN_KEYS)
  })

  it('offers carriers but not flat fee, because the rail is asking which plan', () => {
    expect(LEGAL_PLAN_OPTIONS.map(option => option.value)).toEqual([
      'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan',
    ])
  })

  it('applies to an EP-LP lead and to nothing else', () => {
    for (const key of PLAN_KEYS) {
      const definition = leadFieldDefinition(key)!
      expect(leadFieldApplies(definition, lead({ practice_area: 'EP-LP' }))).toBe(true)
      expect(leadFieldApplies(definition, lead({ practice_area: 'Estate Planning - LP' }))).toBe(true)
      expect(leadFieldApplies(definition, lead({ practice_area: 'EP' }))).toBe(false)
      expect(leadFieldApplies(definition, lead({ practice_area: 'Probate' }))).toBe(false)
      expect(leadFieldApplies(definition, lead({ practice_area: null }))).toBe(false)
    }
  })

  it('shows the carrier display name and reads a member ID and service dates', () => {
    const planned = lead({
      practice_area: 'EP-LP',
      billing_type: 'metlife',
      legal_plan_member_id: 'MET-90210',
      legal_plan_service_start: '2026-01-01',
      legal_plan_service_end: '2026-12-31',
    })
    expect(leadFieldDefinition('legalPlan')!.display(planned, null)).toBe('MetLife')
    expect(leadFieldDefinition('legalPlanMemberId')!.display(planned, null)).toBe('MET-90210')
    expect(leadFieldDefinition('legalPlanServiceStart')!.display(planned, null)).toBe('2026-01-01')
    expect(leadFieldDefinition('legalPlanServiceEnd')!.display(planned, null)).toBe('2026-12-31')
    expect(PLAN_KEYS.every(key => leadFieldDefinition(key)!.complete(planned, null))).toBe(true)
  })

  it('treats a flat-fee lead as having no plan rather than showing a plan name', () => {
    const flat = lead({ practice_area: 'EP-LP', billing_type: 'flat_fee' })
    expect(leadFieldDefinition('legalPlan')!.display(flat, null)).toBeNull()
    expect(leadFieldDefinition('legalPlan')!.complete(flat, null)).toBe(false)
  })
})

describe('readiness scoring', () => {
  it('leaves plan questions out of a plain EP lead entirely', () => {
    const readiness = computeLeadReadiness(lead({ practice_area: 'EP' }), null)
    expect(readiness.items.some(item => PLAN_KEYS.includes(item.key as typeof PLAN_KEYS[number])))
      .toBe(false)
  })

  it('counts them for an EP-LP lead without blocking conversion', () => {
    const readiness = computeLeadReadiness(lead({ practice_area: 'EP-LP' }), null)
    const planItems = readiness.items.filter(
      item => PLAN_KEYS.includes(item.key as typeof PLAN_KEYS[number]),
    )
    expect(planItems).toHaveLength(4)
    expect(planItems.every(item => !item.complete)).toBe(true)
    // Plan billing is a claim detail, not an engagement prerequisite.
    expect(planItems.every(item => !item.required)).toBe(true)
    expect(readiness.missing.some(item => PLAN_KEYS.includes(item.key as typeof PLAN_KEYS[number])))
      .toBe(false)
  })

  it('does not penalize an EP lead for questions it was never asked', () => {
    const ep = computeLeadReadiness(lead({ practice_area: 'EP' }), null)
    const lp = computeLeadReadiness(lead({ practice_area: 'EP-LP' }), null)
    expect(ep.total).toBe(lp.total - 4)
    expect(ep.percent).toBeGreaterThan(lp.percent)
  })
})

describe('migration', () => {
  it('adds the four columns to client_intake under the shared billing enum', () => {
    expect(migration).toContain('add column if not exists billing_type text')
    expect(migration).toContain('add column if not exists legal_plan_member_id text')
    expect(migration).toContain('add column if not exists legal_plan_service_start date')
    expect(migration).toContain('add column if not exists legal_plan_service_end date')
    expect(migration).toContain('client_intake_billing_type_check')
  })

  it('lets both lead RPCs accept the plan fields', () => {
    for (const field of PLAN_KEYS) expect(migration).toContain(`'${field}'`)
    expect(migration).toContain('create or replace function public.update_lead_opportunity_field')
    expect(migration).toContain('create or replace function public.update_lead_opportunity_details')
  })

  it('syncs plan billing to the lead matter so conversion inherits it', () => {
    expect(migration).toContain('legal_plan = public.legal_plan_display_name(v_lead.billing_type)')
    expect(migration).toContain('legal_plan_member_id = v_lead.legal_plan_member_id')
    expect(migration).toContain('legal_plan_service_start = v_lead.legal_plan_service_start')
    expect(migration).toContain('legal_plan_service_end = v_lead.legal_plan_service_end')
  })

  it('keeps the RPCs locked to service_role', () => {
    expect(migration).toContain(
      'revoke execute on function public.update_lead_opportunity_field(uuid, text, jsonb, uuid) from public, anon, authenticated',
    )
    expect(migration).toContain(
      'grant execute on function public.update_lead_opportunity_details(uuid, jsonb, jsonb, uuid) to service_role',
    )
  })
})
