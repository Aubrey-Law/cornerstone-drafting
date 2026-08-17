import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(): string {
  const dir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(dir).find(name => name.endsWith('_invoice_payments_processor.sql'))
  if (!filename) throw new Error('invoice payments migration not found')
  return fs.readFileSync(path.join(dir, filename), 'utf8')
}

describe('invoice checkout migration', () => {
  it('records the no-IOLTA decision where a future reader will find it', () => {
    // The absence of trust accounting is a decision, not an oversight, and the
    // migration is where someone will look for why.
    // Collapse the SQL comment wrapping before matching prose.
    const prose = migration().replace(/\s*\n--\s*/g, ' ')
    expect(prose).toMatch(/No trust accounting here, deliberately/)
    expect(prose).toMatch(/IOLTA/)
    expect(prose).toMatch(/flat fees earned on receipt/)
    // And says what would have to change first if that ever stops being true.
    expect(prose).toMatch(/cannot be re-routed after the fact/)
  })

  it('stores sessions in integer cents, one row per provider session', () => {
    const sql = migration()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_checkout_sessions')
    expect(sql).toContain('amount_cents integer NOT NULL CHECK (amount_cents > 0)')
    expect(sql).toContain('UNIQUE (provider, provider_session_id)')
    expect(sql).toContain("CHECK (provider IN ('stripe', 'lawpay'))")
  })

  it('reuses the existing webhook dedupe ledger rather than adding another', () => {
    const sql = migration()
    expect(sql).toContain('telephony_webhook_events_provider_check')
    expect(sql).toContain("'stripe'::text")
    expect(sql).toContain("'lawpay'::text")
    // The providers already there must survive the rewrite.
    for (const provider of ['twilio', 'telnyx', 'retell', 'calcom']) {
      expect(sql).toContain(`'${provider}'::text`)
    }
    expect(sql).not.toMatch(/CREATE TABLE .*payment_webhook_events/)
  })

  it('keeps completion idempotent and staff-free', () => {
    const sql = migration()
    const fn = sql.slice(sql.indexOf('FUNCTION public.complete_invoice_checkout_session'))

    // A replay returns the invoice untouched instead of paying twice.
    expect(fn).toContain('IF v_session.payment_group_id IS NOT NULL THEN')
    // The payer is a client, so there is no actor to check — the grant is the
    // control, exactly as it is for claim_webhook_event.
    expect(fn).not.toContain('assert_billing_actor')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.complete_invoice_checkout_session')
  })

  it('allocates an online payment exactly as a manual one', () => {
    const sql = migration()
    const fn = sql.slice(sql.indexOf('FUNCTION public.complete_invoice_checkout_session'))

    expect(fn).toContain('ORDER BY ii.position')
    expect(fn).toContain('FOR UPDATE OF bi')
    expect(fn).toContain('least(v_remaining, v_line.amount_billed - v_item_collected)')
    expect(fn).toContain("RAISE EXCEPTION 'Payment exceeds invoice balance'")
    // And mirrors the engagement fee against the charge, not the invoice.
    expect(fn).toContain("IF v_line.source = 'engagement' THEN")
    expect(fn).toContain('v_item_collected + v_apply >= v_line.amount_billed')
  })

  it('records the processor fee without subtracting it from what the client paid', () => {
    const sql = migration()
    const fn = sql.slice(sql.indexOf('FUNCTION public.complete_invoice_checkout_session'))
    // amount is the gross; the fee rides alongside in its own column.
    expect(fn).toContain('processor_fee_cents')
    expect(fn).toContain('v_apply')
    expect(fn).not.toMatch(/v_apply\s*-\s*.*fee/)
  })

  it('puts the pay link on the invoice so it reaches the PDF, email and portal', () => {
    const sql = migration()
    const fn = sql.slice(sql.indexOf('FUNCTION public.record_invoice_checkout_session'))
    expect(fn).toContain('SET payment_link = p_checkout_url')
  })

  it('keeps every new function service-role only', () => {
    const sql = migration()
    for (const fn of [
      'record_invoice_checkout_session',
      'complete_invoice_checkout_session',
      'close_invoice_checkout_session',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}(`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`)
    }
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.invoice_checkout_sessions FROM authenticated')
  })

  it('refuses a checkout on an invoice that cannot take one', () => {
    const sql = migration()
    expect(sql).toContain("IF v_invoice.status IN ('draft', 'void', 'paid') THEN")
  })
})
