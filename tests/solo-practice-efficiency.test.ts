import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adjustedInvoiceBalance } from '@/lib/billing/invoices'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql')

describe('solo-practice billing and workflow foundation', () => {
  it('adds snapshotted schedules with the five approved milestone states', () => {
    expect(migration).toContain('create table public.service_packages')
    expect(migration).toContain('create table public.matter_fee_schedules')
    expect(migration).toContain('create table public.matter_fee_milestones')
    expect(migration).toContain("state in ('scheduled', 'ready', 'invoiced', 'paid', 'waived')")
    expect(migration).toContain('unique (matter_id, milestone_key)')
  })

  it('allocates a fixed 50/50 schedule in cents with the remainder on the last milestone', () => {
    expect(migration).toContain('floor(p_agreed_total_cents * v_row.percentage_bps / 10000.0)::integer')
    expect(migration).toContain('p_agreed_total_cents - v_allocated')
    expect(migration).toContain("('engagement', 'Engagement phase fee', 'engagement_completed', 5000, 0)")
    expect(migration).toContain("('drafts-approved', 'Draft approval phase fee', 'drafts_approved', 5000, 1)")
  })

  it('keeps historical billing unchanged and legal-plan claims outside client schedules', () => {
    expect(migration).toContain('Historical billing exists; use attorney-approved manual conversion')
    expect(migration).toContain("Legal-plan claims cannot create client fee schedules")
    expect(migration).toContain("not in ('metlife', 'legalease', 'arag', 'legal_plan')")
  })

  it('makes workflow jobs idempotent, retryable, bounded, and staff-visible', () => {
    expect(migration).toContain('dedupe_key text not null unique')
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('attempts >= max_attempts')
    expect(migration).toContain("'matter_fee_milestones', 'workflow_jobs', 'invoice_reminders'")
    expect(migration).toContain("t || '_staff_select'")
    expect(read('vercel.json')).toContain('/api/cron/workflow-jobs')
  })

  it('enforces financial close-out while preserving a documented attorney exception', () => {
    expect(migration).toContain('transition_matter_status_with_closeout')
    expect(migration).toContain('Resolve billing before close-out')
    expect(migration).toContain('matter_financial_exceptions')
    expect(migration).toContain("ba.balance_effect = 'debit'")
    expect(migration).toContain("ba.status = 'posted'")
    expect(read('app/api/admin/matters/[id]/status/route.ts')).toContain('transition_matter_status_with_closeout')
  })

  it('requires incurred costs and never introduces trust-account destinations', () => {
    expect(migration).toContain('billing_items_cost_incurred_check')
    expect(migration).toContain("case when p_kind = 'cost' then current_date else null end")
    expect(migration.toLowerCase()).not.toContain('iolta')
  })

  it('applies credits and payment reversals in opposite directions', () => {
    expect(adjustedInvoiceBalance(100_00, 20_00, [
      { amount_cents: 10_00, balance_effect: 'credit' },
    ])).toBe(70_00)
    expect(adjustedInvoiceBalance(100_00, 100_00, [
      { amount_cents: 25_00, balance_effect: 'debit' },
    ])).toBe(25_00)
  })

  it('keeps conflict-check implementation outside the change set', () => {
    expect(migration.toLowerCase()).not.toContain('conflict_check')
    expect(migration.toLowerCase()).not.toContain('conflict check')
  })
})

describe('solo-practice navigation and drafting safeguards', () => {
  it('groups the firm navigation and retires Inbox', () => {
    const nav = read('app/admin/AdminLayoutClient.tsx')
    for (const group of ['Daily', 'Clients', 'Work', 'Finance', 'Tools']) expect(nav).toContain(`'${group}'`)
    expect(nav).not.toContain("href: '/admin/inbox'")
    expect(nav.indexOf("label: 'Drafting'")).toBeLessThan(nav.indexOf("label: 'Billing'"))
  })

  it('offers a full portal account route and an editable funding roadmap', () => {
    expect(read('app/(portal)/PortalShell.tsx')).toContain("href: '/account'")
    expect(read('app/(portal)/account/page.tsx')).toContain('showAll')
    const assets = read('app/admin/drafting/[matterId]/design/sections/AssetsSection.tsx')
    expect(assets).toContain('Current owner / title')
    expect(assets).toContain('Trust Funding Roadmap')
    expect(assets).toContain('funding_plan')
  })
})
