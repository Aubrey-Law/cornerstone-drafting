import { describe, expect, it } from 'vitest'
import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import type { getAdminClient } from '@/lib/supabaseAdmin'

function client(failure?: string) {
  const payments = [
    { invoice_id: 'partial', amount: 2_000 },
    { invoice_id: 'paid', amount: 10_000 },
    { invoice_id: 'credited', amount: 2_000 },
    { invoice_id: 'refund', amount: 10_000 },
  ]
  const adjustments = [
    { invoice_id: 'credited', amount_cents: 8_000, balance_effect: 'credit', status: 'posted' },
    { invoice_id: 'partial', amount_cents: 8_000, balance_effect: 'credit', status: 'draft' },
    { invoice_id: 'refund', amount_cents: 3_000, balance_effect: 'debit', status: 'posted' },
  ]
  return { from: (table: string) => {
    if (!['billing_payments', 'billing_adjustments'].includes(table)) throw new Error(`Unexpected table ${table}`)
    return { select: () => ({ in: (_key: string, ids: string[]) => {
      const rows = table === 'billing_payments' ? payments : adjustments
      const filtered = rows.filter(row => ids.includes(row.invoice_id))
      return { order: () => ({ range: (start: number, end: number) => Promise.resolve({
        data: filtered.slice(start, end + 1), error: failure === table ? { message: 'unavailable' } : null,
      }) }) }
    } }) }
  } } as unknown as ReturnType<typeof getAdminClient>
}

describe('shared invoice balances', () => {
  it('agrees on payments, posted credits, refunds, and credit-note balances', async () => {
    const rows = ['unpaid', 'partial', 'paid', 'credited', 'refund', 'note'].map(id => ({
      id, subtotal_cents: 10_000, kind: id === 'note' ? 'credit_note' : 'invoice',
    }))
    expect(Object.fromEntries(await loadInvoiceBalances(client(), rows))).toEqual({
      unpaid: 10_000, partial: 8_000, paid: 0, credited: 0, refund: 3_000, note: 0,
    })
  })
  it.each(['billing_payments', 'billing_adjustments'])('rejects unavailable %s instead of overstating a balance', async table => {
    await expect(loadInvoiceBalances(client(table), [{ id: 'partial', subtotal_cents: 10_000, kind: 'invoice' }])).rejects.toThrow()
  })
  it('does not query for an empty authorized selection', async () => {
    const admin = { from: () => { throw new Error('must not query') } } as unknown as ReturnType<typeof getAdminClient>
    expect(await loadInvoiceBalances(admin, [])).toEqual(new Map())
  })
  it('includes payments past the database response limit', async () => {
    const admin = { from: (table: string) => ({ select: () => ({ in: () => ({ order: () => ({
      range: (start: number, end: number) => Promise.resolve({ data: table === 'billing_payments'
        ? Array.from({ length: 1001 }, () => ({ invoice_id: 'many', amount: 1 })).slice(start, end + 1)
        : [], error: null }),
    }) }) }) }) } as unknown as ReturnType<typeof getAdminClient>
    expect((await loadInvoiceBalances(admin, [{ id: 'many', subtotal_cents: 2000, kind: 'invoice' }])).get('many')).toBe(999)
  })
})
