import 'server-only'
import { adjustedInvoiceBalance, type InvoiceBalanceAdjustment } from '@/lib/billing/invoices'
import type { getAdminClient } from '@/lib/supabaseAdmin'

export type InvoiceBalanceSource = { id: string; subtotal_cents: number; kind: string }

export async function allAccountingRows<T>(read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await read(offset)
    if (page.error) throw new Error('Invoice balances are unavailable. Please retry.')
    rows.push(...(page.data ?? []))
    if ((page.data?.length ?? 0) < 1000) return rows
  }
}

/** Already-authorized invoice rows. Failed accounting reads never mean zero. */
export async function loadInvoiceAccounting(
  admin: ReturnType<typeof getAdminClient>,
  invoices: readonly InvoiceBalanceSource[],
): Promise<Map<string, { collected: number; balance: number }>> {
  const balances = new Map<string, { collected: number; balance: number }>()
  for (let offset = 0; offset < invoices.length; offset += 100) {
    const batch = invoices.slice(offset, offset + 100)
    const ids = batch.map(invoice => invoice.id)
    const [payments, adjustments] = await Promise.all([
      allAccountingRows(offset => admin.from('billing_payments').select('invoice_id, amount').in('invoice_id', ids)
        .order('id').range(offset, offset + 999)),
      allAccountingRows(offset => admin.from('billing_adjustments').select('invoice_id, amount_cents, balance_effect, status').in('invoice_id', ids)
        .order('id').range(offset, offset + 999)),
    ])
    const collected = new Map<string, number>()
    for (const payment of payments) {
      if (payment.invoice_id) collected.set(payment.invoice_id, (collected.get(payment.invoice_id) ?? 0) + payment.amount)
    }
    const posted = adjustments as Array<InvoiceBalanceAdjustment & { status: string }>
    for (const invoice of batch) {
      balances.set(invoice.id, { collected: collected.get(invoice.id) ?? 0, balance: invoice.kind === 'credit_note' ? 0 : adjustedInvoiceBalance(
        invoice.subtotal_cents,
        collected.get(invoice.id) ?? 0,
        posted.filter(row => row.invoice_id === invoice.id && row.status === 'posted'),
      ) })
    }
  }
  return balances
}

export async function loadInvoiceBalances(admin: ReturnType<typeof getAdminClient>, invoices: readonly InvoiceBalanceSource[]): Promise<Map<string, number>> {
  const accounting = await loadInvoiceAccounting(admin, invoices)
  return new Map([...accounting].map(([id, value]) => [id, value.balance]))
}
