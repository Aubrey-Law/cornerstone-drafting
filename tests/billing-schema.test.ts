import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function billingMigration(): string {
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(migrationsDir).find(name => name.endsWith('_billing_foundation.sql'))
  if (!filename) throw new Error('billing foundation migration not found')
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

describe('billing foundation migration', () => {
  it('stores constrained integer-cent billing items and payments owned by matters', () => {
    const sql = billingMigration()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.billing_items')
    expect(sql).toContain('matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE')
    expect(sql).toContain('amount_billed integer NOT NULL CHECK (amount_billed > 0)')
    expect(sql).toContain("kind IN ('flat_fee', 'plan_claim', 'cost')")
    expect(sql).toContain("plan IN ('metlife', 'legalease')")
    expect(sql).toContain("status IN ('to_invoice', 'invoiced', 'claim_submitted', 'partial', 'paid')")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.billing_payments')
    expect(sql).toContain('amount integer NOT NULL CHECK (amount > 0)')
    expect(sql).toContain("method IN ('check', 'card', 'ach', 'plan_eft', 'cash')")
  })

  it('enables staff-only RLS and exposes only the privileges the UI needs', () => {
    const sql = billingMigration()

    for (const table of [
      'billing_items',
      'billing_payments',
      'billing_events',
      'billing_nudge_dismissals',
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain("u.role IN ('attorney', 'admin')")
    expect(sql).toContain('GRANT SELECT ON public.billing_items, public.billing_payments, public.billing_events TO authenticated')
    expect(sql).not.toContain('GRANT INSERT, UPDATE, DELETE ON public.billing_items TO authenticated')
    expect(sql).not.toContain('GRANT INSERT, UPDATE, DELETE ON public.billing_payments TO authenticated')
  })

  /**
   * Describes the seeder as this migration first wrote it. The live function
   * has been replaced twice since — most recently by
   * `_engagement_seed_respects_payor.sql`, which is where payor handling and
   * the deletion guard are asserted (tests/engagement-seed-payor.test.ts).
   */
  it('seeds an engagement item once when a signed matter has a positive fee', () => {
    const sql = billingMigration()

    expect(sql).toContain('CREATE UNIQUE INDEX billing_items_one_engagement_source')
    expect(sql).toContain("WHERE source = 'engagement'")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.seed_engagement_billing_item()')
    expect(sql).toContain('round(NEW.flat_fee_amount * 100)::integer')
    expect(sql).toContain("NEW.engagement_signed IS TRUE")
    expect(sql).toContain('ON CONFLICT (matter_id) WHERE source =')
    expect(sql).toContain('CREATE TRIGGER trg_seed_engagement_billing_item')
  })

  it('makes financial writes atomic, actor-checked, audited, and unavailable to PUBLIC', () => {
    const sql = billingMigration()

    for (const fn of [
      'mark_billing_item_invoiced',
      'record_billing_payment',
      'mark_billing_reminder_sent',
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
    }
    expect(sql.match(/u\.id = p_actor_id[\s\S]{0,120}u\.role IN \('attorney', 'admin'\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(sql).toContain("RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501'")
    expect(sql).toContain('INSERT INTO public.billing_events')
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.billing_events FROM authenticated')
  })

  it('rejects overpayments and derives partial or paid status inside the payment transaction', () => {
    const sql = billingMigration()

    expect(sql).toContain("RAISE EXCEPTION 'Payment exceeds open balance' USING ERRCODE = '22003'")
    expect(sql).toContain("WHEN v_collected + p_amount = v_item.amount_billed THEN 'paid'")
    expect(sql).toContain("ELSE 'partial'")
  })

  it('keeps the legacy engagement fee summary compatible without treating costs as fees', () => {
    const sql = billingMigration()

    expect(sql).toContain("v_item.source = 'engagement'")
    expect(sql).toContain("fee_payment_status = CASE")
    expect(sql).toContain("WHEN v_collected + p_amount = v_item.amount_billed THEN 'paid_in_full'")
    expect(sql).toContain("ELSE 'deposit'")
    expect(sql).toContain('fee_collected = (v_collected + p_amount = v_item.amount_billed)')
  })

  it('stores the annual collection goal and per-user weekly nudge dismissals', () => {
    const sql = billingMigration()

    expect(sql).toContain('billing_annual_goal_cents integer NOT NULL DEFAULT 12000000')
    expect(sql).toContain('PRIMARY KEY (user_id, nudge_key, week_start)')
    expect(sql).toContain('user_id = (select auth.uid())')
  })
})
