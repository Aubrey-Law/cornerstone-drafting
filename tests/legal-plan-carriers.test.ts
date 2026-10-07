import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATTER_BILLING_TYPES } from '@/lib/billing/billingType'
import {
  billingPlanFor,
  billingPlanLabel,
  billingPlanLabels,
  billingPlans,
  claimWorkflowSearch,
  createBillingItemSchema,
} from '@/lib/billing/types'
import { chargePayer, invoicePayerLabels, invoicePayers, isCarrierInvoice } from '@/lib/billing/invoices'

/**
 * Every named plan the firm takes (MetLife, LegalEASE, ARAG and CLC) is a
 * carrier everywhere a carrier is listed, so a claim is never filed against
 * the wrong one.
 */

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270129090100_legal_plans_metlife_legalease_arag_clc.sql'),
  'utf8',
)

describe('legal-plan carriers', () => {
  it('are every named plan in the billing types', () => {
    const named = MATTER_BILLING_TYPES.filter(type => type !== 'flat_fee' && type !== 'other_legal_plan')
    expect([...billingPlans].sort()).toEqual([...named].sort())
  })

  it('map a matter’s billing type or plan display name to its carrier', () => {
    expect(billingPlanFor('arag')).toBe('arag')
    expect(billingPlanFor('ARAG')).toBe('arag')
    expect(billingPlanFor('clc')).toBe('clc')
    expect(billingPlanFor('CLC')).toBe('clc')
    // Plans the firm no longer takes have no carrier to bill.
    expect(billingPlanFor('Hyatt')).toBeNull()
    expect(billingPlanFor('LegalShield')).toBeNull()
    expect(billingPlanFor('MetLife')).toBe('metlife')
    expect(billingPlanFor('LegalEASE')).toBe('legalease')
    expect(billingPlanFor('Other legal plan')).toBeNull()
    expect(billingPlanFor('flat_fee')).toBeNull()
    expect(billingPlanFor(null)).toBeNull()
  })

  it('are named, and fall back to a neutral name when none is recorded', () => {
    expect(billingPlanLabels).toMatchObject({ metlife: 'MetLife', legalease: 'LegalEASE', arag: 'ARAG', clc: 'CLC' })
    expect(billingPlanLabel(null)).toBe('Legal plan')
    expect(claimWorkflowSearch('metlife')).toBe('metlife-claim')
    expect(claimWorkflowSearch('arag')).toBe('arag')
    expect(claimWorkflowSearch(null)).toBe('claim')
  })

  it('can be billed: a plan claim to any carrier validates and pays to that carrier', () => {
    for (const plan of billingPlans) {
      const parsed = createBillingItemSchema.safeParse({ matterId: '00000000-0000-4000-8000-000000000001', kind: 'plan_claim', label: 'Claim', plan, amountBilled: 10_000 })
      expect(parsed.success, plan).toBe(true)
      expect(chargePayer({ kind: 'plan_claim', plan })).toBe(plan)
    }
  })

  it('are invoice payers, and every non-client payer is a carrier invoice', () => {
    expect([...invoicePayers]).toEqual(['client', ...billingPlans])
    for (const plan of billingPlans) {
      expect(isCarrierInvoice({ payer: plan })).toBe(true)
      expect(invoicePayerLabels[plan]).toBeTruthy()
    }
    expect(invoicePayerLabels.metlife).toBe('MetLife Legal Plans')
    expect(isCarrierInvoice({ payer: 'client' })).toBe(false)
    expect(isCarrierInvoice({ payer: null })).toBe(false)
    expect(isCarrierInvoice({})).toBe(false)
  })

  it('match the database checks', () => {
    const list = billingPlans.map(plan => `'${plan}'`).join(', ')
    expect(migration).toContain(`plan in (${list})`)
    expect(migration).toContain(`payer in ('client', ${list})`)
  })
})
