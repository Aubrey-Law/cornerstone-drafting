import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  batchInvoiceSchema,
  planBatchInvoices,
  resolveDueDate,
  type BatchInvoiceResult,
} from '@/lib/billing/invoices'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Bills a multi-matter ledger selection in one pass, one draft invoice per
 * matter.
 *
 * Grouping happens here, not on the client: an invoice belongs to exactly one
 * matter, and that rule should not depend on how the caller sliced the
 * selection. A group that the database rejects is reported in `skipped` rather
 * than failing the batch — one plan claim in a selection of twelve should not
 * cost you the other eleven invoices.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = batchInvoiceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid batch' },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('billing_items')
    .select('id, matter_id, kind, amount_billed, invoice_id')
    .in('id', parsed.data.itemIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    id: string
    matter_id: string
    kind: string
    amount_billed: number
    invoice_id: string | null
  }
  const items = (data ?? []) as Row[]
  if (items.length === 0) {
    return NextResponse.json({ error: 'None of those charges exist' }, { status: 404 })
  }

  // Collected amounts decide whether a charge still has anything to bill.
  const paymentResult = await admin
    .from('billing_payments')
    .select('billing_item_id, amount')
    .in('billing_item_id', items.map(item => item.id))
  if (paymentResult.error) {
    return NextResponse.json({ error: paymentResult.error.message }, { status: 500 })
  }
  const collected = new Map<string, number>()
  for (const payment of (paymentResult.data ?? []) as { billing_item_id: string; amount: number }[]) {
    collected.set(
      payment.billing_item_id,
      (collected.get(payment.billing_item_id) ?? 0) + payment.amount,
    )
  }

  const matterIds = [...new Set(items.map(item => item.matter_id))]
  const contextResult = await admin
    .from('v_matter_pipeline')
    .select('matter_id, client_name, matter_name')
    .in('matter_id', matterIds)
  const contextById = new Map(
    ((contextResult.data ?? []) as {
      matter_id: string
      client_name: string | null
      matter_name: string | null
    }[]).map(row => [row.matter_id, row]),
  )

  const { groups, skipped } = planBatchInvoices(items.map(item => ({
    id: item.id,
    matterId: item.matter_id,
    clientName: contextById.get(item.matter_id)?.client_name
      ?? contextById.get(item.matter_id)?.matter_name
      ?? 'Unknown client',
    matterNumber: null,
    kind: item.kind,
    amountBilled: item.amount_billed,
    balance: item.amount_billed - (collected.get(item.id) ?? 0),
    invoiceId: item.invoice_id,
  })))

  const dueDate = resolveDueDateFromDays(parsed.data.issueDate, parsed.data.dueInDays)
  const result: BatchInvoiceResult = { created: [], skipped: [...skipped] }

  for (const group of groups) {
    const { data: invoice, error: groupError } = await admin.rpc('create_invoice_draft', {
      p_matter_id: group.matterId,
      p_item_ids: group.itemIds,
      p_issue_date: parsed.data.issueDate,
      p_due_date: dueDate,
      p_notes: null,
      p_terms: parsed.data.terms ?? null,
      p_bill_to_name: null,
      p_bill_to_email: null,
      p_payment_link: null,
      p_actor_id: auth.userId,
    })
    if (groupError) {
      // Report and keep going, so one bad group does not cost the rest.
      result.skipped.push({
        matterId: group.matterId,
        clientName: group.clientName,
        reason: groupError.message,
      })
      continue
    }
    const created = invoice as { id: string; subtotal_cents: number } | null
    if (created) {
      result.created.push({
        invoiceId: created.id,
        matterId: group.matterId,
        subtotalCents: created.subtotal_cents,
      })
    }
  }

  return NextResponse.json(result, { status: result.created.length > 0 ? 201 : 200 })
}

/** `dueInDays` is a plain offset; the composer's named terms resolve the same way. */
function resolveDueDateFromDays(issueDate: string, days: number): string {
  if (days === 0) return resolveDueDate(issueDate, 'due_on_receipt')
  if (days === 15) return resolveDueDate(issueDate, 'net_15')
  if (days === 30) return resolveDueDate(issueDate, 'net_30')
  if (days === 60) return resolveDueDate(issueDate, 'net_60')
  const [year, month, day] = issueDate.split('-').map(Number)
  const due = new Date(Date.UTC(year, month - 1, day))
  due.setUTCDate(due.getUTCDate() + days)
  return due.toISOString().slice(0, 10)
}
