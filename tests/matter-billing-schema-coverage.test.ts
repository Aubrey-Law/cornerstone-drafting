import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MATTER_BILLING_TYPES,
  isLegalPlanBilling,
  legalPlanDisplayName,
  normalizeMatterBillingType,
} from '@/lib/billing/billingType'
import {
  normalizeReferralSource,
  quietDays,
  referralSourceOtherFallback,
} from '@/lib/matter/referralSource'
import { buildCloseOutGates } from '@/app/admin/matters/[id]/tabs/billing-cards'

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260903000000_matter_page_schema_coverage.sql',
)

describe('billing type', () => {
  it('is the one enum for how a matter is paid', () => {
    expect([...MATTER_BILLING_TYPES]).toEqual([
      'flat_fee', 'metlife', 'legalease', 'arag', 'clc', 'other_legal_plan',
    ])
  })

  it('reads the free text the migration also maps', () => {
    expect(normalizeMatterBillingType('MetLife')).toBe('metlife')
    expect(normalizeMatterBillingType('Met Life')).toBe('metlife')
    expect(normalizeMatterBillingType('LegalEASE plan')).toBe('legalease')
    expect(normalizeMatterBillingType('CLC')).toBe('clc')
    expect(normalizeMatterBillingType('Legal Shield')).toBe('other_legal_plan')
    expect(normalizeMatterBillingType('Prepaid plan')).toBe('other_legal_plan')
    expect(normalizeMatterBillingType('Flat Fee')).toBe('flat_fee')
    expect(normalizeMatterBillingType(null)).toBeNull()
  })

  it('derives legal_plan as a display name, never an independent answer', () => {
    expect(legalPlanDisplayName('metlife')).toBe('MetLife')
    expect(legalPlanDisplayName('flat_fee')).toBeNull()
    expect(legalPlanDisplayName(null)).toBeNull()
  })

  it('treats only non-flat-fee billing as plan billing', () => {
    expect(isLegalPlanBilling('flat_fee')).toBe(false)
    expect(isLegalPlanBilling('arag')).toBe(true)
    expect(isLegalPlanBilling(null)).toBe(false)
  })
})

describe('close-out gates', () => {
  it('holds a plan matter until all four are recorded', () => {
    const gates = buildCloseOutGates({ billing_type: 'metlife' })
    expect(gates.map(gate => gate.key)).toEqual([
      'work_finished', 'closing_package', 'claim_submitted', 'reimbursement_received',
    ])
    expect(gates.every(gate => gate.met)).toBe(false)

    const done = buildCloseOutGates({
      billing_type: 'metlife',
      work_finished_date: '2026-08-01',
      closing_package_sent_date: '2026-08-02',
      claim_submitted_date: '2026-08-03',
      reimbursement_received_date: '2026-08-20',
    })
    expect(done.every(gate => gate.met)).toBe(true)
  })

  it('does not strand a flat-fee matter behind claim gates it can never meet', () => {
    const gates = buildCloseOutGates({
      billing_type: 'flat_fee',
      work_finished_date: '2026-08-01',
      closing_package_sent_date: '2026-08-02',
    })
    expect(gates.every(gate => gate.met)).toBe(true)
    expect(gates.find(gate => gate.key === 'claim_submitted')?.detail).toContain('Not applicable')
  })
})

describe('referral source', () => {
  it('folds legacy free text onto the picklist', () => {
    expect(normalizeReferralSource('Google')).toBe('google')
    expect(normalizeReferralSource('google search')).toBe('google')
    expect(normalizeReferralSource('Web')).toBe('website')
    expect(normalizeReferralSource('Client referral')).toBe('client_referral')
    expect(normalizeReferralSource('')).toBe('')
  })

  it('keeps unrecognised text visible under Other rather than dropping it', () => {
    expect(normalizeReferralSource('Rotary breakfast')).toBe('other')
    expect(referralSourceOtherFallback('Rotary breakfast', null)).toBe('Rotary breakfast')
    expect(referralSourceOtherFallback('other', 'Rotary breakfast')).toBe('Rotary breakfast')
    expect(referralSourceOtherFallback('google', null)).toBe('')
  })
})

describe('quiet days', () => {
  const now = new Date('2026-08-06T12:00:00.000Z')

  it('counts whole days since the last communication', () => {
    expect(quietDays('2026-08-06T09:00:00.000Z', now)).toBe(0)
    expect(quietDays('2026-07-16T12:00:00.000Z', now)).toBe(21)
  })

  it('has no answer when there has never been a communication', () => {
    expect(quietDays(null, now)).toBeNull()
    expect(quietDays('not a date', now)).toBeNull()
  })
})

describe('the migration', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8')

  it('adds every new column and reloads the PostgREST schema cache', () => {
    for (const column of [
      'referral_source_other', 'ep_has_real_estate', 'ep_has_pets',
      'ep_anticipated_inheritance', 'ep_accounts_retitled', 'legal_plan_member_id',
      'claim_amount', 'claim_submitted_date', 'reimbursement_received_date',
      'payment_link_sent_at', 'work_started_date', 'work_finished_date',
      'closing_package_sent_date', 'next_action_date',
    ]) {
      expect(sql).toContain(column)
    }
    expect(sql).toContain('from_prior_relationship')
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })

  it('constrains billing_type to the enum and backfills the free text', () => {
    expect(sql).toContain('matter_details_billing_type_check')
    // The list itself was last restated when the plans became the firm's four.
    const latest = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20270129090000_legal_plans_metlife_legalease_arag_clc.sql'),
      'utf8',
    )
    expect(latest).toContain(`billing_type in (\n      ${MATTER_BILLING_TYPES.map(value => `'${value}'`).join(', ')}\n    )`)
    expect(sql).toMatch(/update public\.matter_details[\s\S]*set billing_type = case/)
  })

  it('leaves what it cannot identify unclassified rather than guessing', () => {
    // Live rows carry unresolved Lawmatics option IDs in legal_plan. Calling
    // those a legal plan would give each matter a claim block it may not have.
    const backfill = sql.slice(sql.indexOf('set billing_type = case'), sql.indexOf('end\nwhere'))
    expect(backfill).not.toMatch(/coalesce\(trim\(legal_plan\), ''\) <> ''\s+then 'other_legal_plan'/)
    expect(backfill).toMatch(/else null/)
    // A plan matter still has to be named to be classified as one.
    expect(backfill).toMatch(/billing_type ilike '%plan%'\s+then 'other_legal_plan'/)
  })

  it('only rewrites legal_plan where billing_type actually resolved', () => {
    const displayName = sql.slice(sql.indexOf('set legal_plan = case billing_type'))
    expect(displayName).toMatch(/where billing_type is not null/)
  })

  it('stores no derived value — balance due and last contact get no column', () => {
    expect(sql).not.toContain('balance_due')
    expect(sql).not.toContain('last_client_contact')
    expect(sql).not.toContain('drafts_due')
  })
})
