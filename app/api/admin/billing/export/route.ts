import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

function cell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const month = new URL(req.url).searchParams.get('month')
  const start = /^\d{4}-\d{2}$/.test(month ?? '') ? `${month}-01` : null
  const end = start ? new Date(`${start}T00:00:00Z`) : null
  if (end) end.setUTCMonth(end.getUTCMonth() + 1)
  const admin = getAdminClient()
  const [invoices, payments, adjustments, items] = await Promise.all([
    admin.from('invoices').select('id, matter_id, number, kind, subtotal_cents, status, issue_date'),
    admin.from('billing_payments').select('invoice_id, payment_group_id, amount, method, received_at, processor_fee_cents, external_reference'),
    admin.from('billing_adjustments').select('invoice_id, kind, amount_cents, balance_effect, status, provider, external_reference, created_at'),
    admin.from('billing_items').select('matter_id, kind, label, amount_billed, status, plan, created_at'),
  ])
  const errors = [invoices.error, payments.error, items.error].filter(Boolean)
  if (errors.length) return NextResponse.json({ error: errors[0]!.message }, { status: 500 })
  const invoiceById = new Map((invoices.data ?? []).map(row => [row.id, row]))
  const inMonth = (iso: string | null) => !start || !iso || (iso >= start && iso < end!.toISOString())
  const rows: unknown[][] = [[
    'Record type', 'Date', 'Matter ID', 'Invoice', 'Description', 'Gross',
    'Processor fee', 'Net', 'External reference', 'Status',
  ]]
  for (const invoice of invoices.data ?? []) {
    if (!inMonth(invoice.issue_date)) continue
    rows.push(['invoice', invoice.issue_date, invoice.matter_id, invoice.number, invoice.kind,
      (invoice.subtotal_cents / 100).toFixed(2), '', '', '', invoice.status])
  }
  const groups = new Map<string, NonNullable<typeof payments.data>>()
  for (const payment of payments.data ?? []) {
    if (!inMonth(payment.received_at)) continue
    const key = payment.payment_group_id
    groups.set(key, [...(groups.get(key) ?? []), payment])
  }
  for (const [groupId, group] of groups) {
    const first = group[0]
    const invoice = first.invoice_id ? invoiceById.get(first.invoice_id) : null
    const gross = group.reduce((sum, row) => sum + row.amount, 0)
    const fee = group.reduce((sum, row) => sum + row.processor_fee_cents, 0)
    rows.push([first.method === 'plan_eft' ? 'legal_plan_reimbursement' : 'payment', first.received_at,
      invoice?.matter_id ?? '', invoice?.number ?? '', first.method,
      (gross / 100).toFixed(2), (fee / 100).toFixed(2), ((gross - fee) / 100).toFixed(2),
      first.external_reference ?? groupId, 'posted'])
  }
  if (!adjustments.error) for (const adjustment of adjustments.data ?? []) {
    if (!inMonth(adjustment.created_at)) continue
    const invoice = invoiceById.get(adjustment.invoice_id)
    rows.push([adjustment.kind, adjustment.created_at, invoice?.matter_id ?? '', invoice?.number ?? '',
      adjustment.balance_effect, (adjustment.amount_cents / 100).toFixed(2), '', '',
      adjustment.external_reference ?? '', adjustment.status])
  }
  for (const item of items.data ?? []) {
    if (item.kind !== 'plan_claim' || !inMonth(item.created_at)) continue
    rows.push(['legal_plan_claim', item.created_at, item.matter_id, '', item.label,
      (item.amount_billed / 100).toFixed(2), '', '', item.plan ?? '', item.status])
  }
  return new NextResponse(rows.map(row => row.map(cell).join(',')).join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cornerstone-accounting-${month ?? 'all'}.csv"`,
    },
  })
}
