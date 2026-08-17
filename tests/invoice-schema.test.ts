import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(suffix: string): string {
  const dir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(dir).find(name => name.endsWith(suffix))
  if (!filename) throw new Error(`${suffix} migration not found`)
  return fs.readFileSync(path.join(dir, filename), 'utf8')
}

const foundation = () => migration('_invoices_foundation.sql')
const rpcs = () => migration('_invoice_rpcs.sql')

describe('invoices foundation migration', () => {
  it('stores integer-cent invoices owned by matters', () => {
    const sql = foundation()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoices')
    expect(sql).toContain('matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE')
    expect(sql).toContain('subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0)')
    expect(sql).toContain("status text NOT NULL DEFAULT 'draft'")
    expect(sql).toContain("CHECK (status IN ('draft', 'issued', 'partial', 'paid', 'void'))")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_items')
    expect(sql).toContain('amount_cents integer NOT NULL CHECK (amount_cents > 0)')
  })

  it('refuses an issued invoice without a number and a due date before its issue date', () => {
    const sql = foundation()

    expect(sql).toContain('CONSTRAINT invoices_issued_has_number')
    expect(sql).toContain("(status = 'draft' AND number IS NULL) OR (status <> 'draft' AND number IS NOT NULL)")
    expect(sql).toContain('CONSTRAINT invoices_due_after_issue')
    expect(sql).toContain('due_date >= issue_date')
  })

  it('numbers invoices from a counter table rather than a sequence', () => {
    // A sequence is non-transactional: a rolled-back issue would leave a hole
    // in the year's series, which reads as a missing invoice to an auditor.
    const sql = foundation()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_number_sequences')
    expect(sql).toContain('last_value integer NOT NULL DEFAULT 0')
    expect(sql).not.toMatch(/CREATE SEQUENCE.*invoice/i)
  })

  it('lets audit rows target an invoice instead of a charge', () => {
    const sql = foundation()

    expect(sql).toContain('ALTER TABLE public.billing_events ALTER COLUMN billing_item_id DROP NOT NULL')
    expect(sql).toContain('CONSTRAINT billing_events_target_check')
    expect(sql).toContain('CHECK (billing_item_id IS NOT NULL OR invoice_id IS NOT NULL)')
    for (const event of [
      'invoice_drafted', 'invoice_issued', 'invoice_sent',
      'invoice_voided', 'invoice_reminder_sent', 'invoice_payment_recorded',
    ]) {
      expect(sql).toContain(`'${event}'`)
    }
  })

  it('keeps payments per charge and adds the grouping columns', () => {
    // buildRows groups payments by billing_item_id to derive every balance on
    // the page; a nullable item id would silently break all of it.
    const sql = foundation()

    expect(sql).toContain('ALTER TABLE public.billing_payments')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS payment_group_id uuid NOT NULL DEFAULT gen_random_uuid()')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS processor_fee_cents integer NOT NULL DEFAULT 0')
    expect(sql).not.toContain('ALTER TABLE public.billing_payments ALTER COLUMN billing_item_id DROP NOT NULL')
  })

  it('enables staff-only RLS and never exposes a draft to a client', () => {
    const sql = foundation()

    for (const table of ['invoices', 'invoice_items', 'invoice_number_sequences']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain("u.role IN ('attorney', 'admin')")
    expect(sql).toContain('CREATE POLICY invoices_client_select')
    expect(sql).toContain('issued_at IS NOT NULL')
    expect(sql).toContain("status <> 'void'")
    expect(sql).toContain('GRANT SELECT ON public.invoices, public.invoice_items TO authenticated')
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM authenticated')
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.invoice_items FROM authenticated')
    expect(sql).not.toContain('GRANT INSERT ON public.invoices TO authenticated')
  })

  it('inlines the ownership test in the line-item policy rather than delegating it', () => {
    // An RLS policy must not depend on the caller phrasing the query as a join.
    const sql = foundation()
    const policy = sql.slice(sql.indexOf('CREATE POLICY invoice_items_client_select'))

    expect(policy).toContain('JOIN public.matters m ON m.id = i.matter_id')
    expect(policy).toContain('m.client_id = (select auth.uid())')
  })

  it('widens the matter activity constraint for invoice events', () => {
    const sql = foundation()

    expect(sql).toContain('matter_activity_event_type_check')
    expect(sql).toContain("'invoice_issued', 'invoice_paid'")
    // The pre-existing values must survive the rewrite.
    expect(sql).toContain("'stage_changed'")
    expect(sql).toContain("'sla_anchor_set'")
  })
})

describe('invoice RPC migration', () => {
  const privileged = [
    'create_invoice_draft',
    'update_invoice_draft',
    'discard_invoice_draft',
    'issue_invoice',
    'attach_invoice_documents',
    'mark_invoice_sent',
    'record_invoice_payment',
    'void_invoice',
    'mark_invoice_reminder_sent',
  ]

  it('makes every invoice write actor-checked, audited and service-role only', () => {
    const sql = rpcs()

    for (const fn of privileged) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`)
    }
    expect(sql).toContain('SET search_path = pg_catalog, public')
    expect(sql).toContain("RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501'")
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
  })

  it('never grants the numbering function, even to service_role', () => {
    // It is only ever called from inside issue_invoice, whose rollback is what
    // releases an unused number.
    const sql = rpcs()

    expect(sql).toContain('REVOKE ALL ON FUNCTION public.next_invoice_number(integer)\n  FROM PUBLIC, anon, authenticated, service_role')
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.next_invoice_number')
  })

  it('keeps a plan claim off a client invoice', () => {
    expect(rpcs()).toContain(
      'A legal plan claim is billed to the carrier and cannot go on a client invoice',
    )
  })

  it('allocates a payment oldest line first, under a row lock', () => {
    const sql = rpcs()
    const fn = sql.slice(sql.indexOf('FUNCTION public.record_invoice_payment'))

    expect(fn).toContain('ORDER BY ii.position')
    expect(fn).toContain('FOR UPDATE OF bi')
    expect(fn).toContain('least(v_remaining, v_line.amount_billed - v_item_collected)')
    expect(fn).toContain("RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22003'")
  })

  it('mirrors the engagement fee summary against the charge, not the invoice total', () => {
    // A $2,000 fee on a $2,450 invoice is paid in full once $2,000 lands on it,
    // even while the invoice is still partial.
    const sql = rpcs()
    const fn = sql.slice(sql.indexOf('FUNCTION public.record_invoice_payment'))

    expect(fn).toContain("IF v_line.source = 'engagement' THEN")
    expect(fn).toContain('v_item_collected + v_apply >= v_line.amount_billed')
    expect(fn).not.toContain('subtotal_cents THEN \'paid_in_full\'')
  })

  it('stops a charge on a live invoice being paid twice', () => {
    const sql = rpcs()
    const fn = sql.slice(sql.indexOf('FUNCTION public.record_billing_payment'))

    expect(fn).toContain('This charge is on invoice %; record the payment against the invoice')
    expect(fn).toContain("status NOT IN ('draft', 'void')")
  })

  it('freezes a charge once its invoice is issued', () => {
    const sql = rpcs()

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.guard_invoiced_billing_item()')
    expect(sql).toContain('CREATE TRIGGER trg_guard_invoiced_billing_item')
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.billing_items')
    expect(sql).toContain('void that invoice or issue a credit note to change it')
  })

  it('refuses to void an invoice that has taken money', () => {
    const sql = rpcs()

    expect(sql).toContain('issue a credit note instead of voiding it')
    expect(sql).toContain('SELECT 1 FROM public.billing_payments WHERE invoice_id = p_invoice_id')
  })

  it('assigns the number without holding the lock across document rendering', () => {
    // issue_invoice takes no document ids; attach_invoice_documents adds them
    // afterwards, so a convert-worker outage costs a retry, not a number.
    const sql = rpcs()

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.issue_invoice(\n  p_invoice_id uuid,\n  p_actor_id uuid\n)')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.attach_invoice_documents(')
  })
})
