import 'server-only'

import {
  invoiceOverdue,
  type Invoice,
  type InvoiceDetail,
  type InvoiceLine,
  type InvoicePaymentGroup,
  type InvoiceStatus,
  type InvoiceableCharge,
} from '@/lib/billing/invoices'
import type { BillingKind, BillingPaymentMethod } from '@/lib/billing/types'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'

type InvoiceRow = {
  id: string
  matter_id: string
  number: string | null
  number_year: number | null
  kind: 'invoice' | 'credit_note'
  status: InvoiceStatus
  subtotal_cents: number
  issue_date: string | null
  due_date: string | null
  notes: string | null
  terms: string | null
  bill_to_name: string | null
  bill_to_email: string | null
  payment_link: string | null
  issued_at: string | null
  sent_at: string | null
  last_reminded_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
  pdf_document_id: string | null
  docx_document_id: string | null
  created_at: string
}

type InvoiceItemRow = {
  id: string
  invoice_id: string
  billing_item_id: string | null
  position: number
  kind: BillingKind
  description: string
  amount_cents: number
}

type InvoicePaymentRow = {
  id: string
  invoice_id: string | null
  payment_group_id: string | null
  amount: number
  method: BillingPaymentMethod
  note: string | null
  received_at: string
  external_reference: string | null
}

type MatterContextRow = {
  matter_id: string
  client_name: string | null
  client_email: string | null
  matter_name: string | null
}

function mapInvoice(
  row: InvoiceRow,
  context: { matterNumber: string | null; pipeline: MatterContextRow | null },
): Invoice {
  return {
    id: row.id,
    matterId: row.matter_id,
    number: row.number,
    numberYear: row.number_year,
    kind: row.kind,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    notes: row.notes,
    terms: row.terms,
    billToName: row.bill_to_name,
    billToEmail: row.bill_to_email,
    paymentLink: row.payment_link,
    issuedAt: row.issued_at,
    sentAt: row.sent_at,
    lastRemindedAt: row.last_reminded_at,
    paidAt: row.paid_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    pdfDocumentId: row.pdf_document_id,
    docxDocumentId: row.docx_document_id,
    createdAt: row.created_at,
    clientName: context.pipeline?.client_name ?? context.pipeline?.matter_name ?? 'Unknown client',
    clientEmail: context.pipeline?.client_email ?? null,
    matterNumber: context.matterNumber,
  }
}

/**
 * One logical payment is stored as one row per charge it was allocated to.
 * Collapse those groups so the invoice shows "one $2,450 payment", not three.
 */
function groupPayments(rows: InvoicePaymentRow[]): InvoicePaymentGroup[] {
  const byGroup = new Map<string, InvoicePaymentRow[]>()
  for (const row of rows) {
    const key = row.payment_group_id ?? row.id
    byGroup.set(key, [...(byGroup.get(key) ?? []), row])
  }
  return [...byGroup.entries()]
    .map(([paymentGroupId, list]) => {
      const [first] = [...list].sort((a, b) => a.id.localeCompare(b.id))
      return {
        paymentGroupId,
        amount: list.reduce((sum, row) => sum + row.amount, 0),
        method: first.method,
        note: first.note,
        receivedAt: first.received_at,
        externalReference: first.external_reference,
      }
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

async function attachContext(rows: InvoiceRow[]): Promise<Invoice[]> {
  if (rows.length === 0) return []
  const admin = getAdminClient()
  const matterIds = [...new Set(rows.map(row => row.matter_id))]
  const [matterResult, pipelineResult] = await Promise.all([
    admin.from('matters').select('id, matter_number').in('id', matterIds),
    admin
      .from('v_matter_pipeline')
      .select('matter_id, client_name, client_email, matter_name')
      .in('matter_id', matterIds),
  ])
  if (matterResult.error) throw new Error(matterResult.error.message)
  if (pipelineResult.error) throw new Error(pipelineResult.error.message)

  const numberById = new Map(
    ((matterResult.data ?? []) as { id: string; matter_number: string | null }[])
      .map(matter => [matter.id, matter.matter_number]),
  )
  const pipelineById = new Map(
    ((pipelineResult.data ?? []) as MatterContextRow[]).map(row => [row.matter_id, row]),
  )

  return rows.map(row => mapInvoice(row, {
    matterNumber: numberById.get(row.matter_id) ?? null,
    pipeline: pipelineById.get(row.matter_id) ?? null,
  }))
}

export interface InvoiceListRow extends Invoice {
  collected: number
  balance: number
  overdue: boolean
  daysPastDue: number
}

function withBalances(
  invoices: Invoice[],
  payments: InvoicePaymentRow[],
  todayKey: string,
): InvoiceListRow[] {
  const collectedByInvoice = new Map<string, number>()
  for (const payment of payments) {
    if (!payment.invoice_id) continue
    collectedByInvoice.set(
      payment.invoice_id,
      (collectedByInvoice.get(payment.invoice_id) ?? 0) + payment.amount,
    )
  }
  return invoices.map(invoice => {
    const collected = collectedByInvoice.get(invoice.id) ?? 0
    const balance = Math.max(0, invoice.subtotalCents - collected)
    return {
      ...invoice,
      collected,
      balance,
      ...invoiceOverdue(invoice, balance, todayKey),
    }
  })
}

/** Every invoice, newest first. Optionally narrowed to one matter or status. */
export async function fetchInvoices(
  filter: { matterId?: string; status?: InvoiceStatus } = {},
  now?: Date,
): Promise<InvoiceListRow[]> {
  const admin = getAdminClient()
  let query = admin.from('invoices').select('*').order('created_at', { ascending: false })
  if (filter.matterId) query = query.eq('matter_id', filter.matterId)
  if (filter.status) query = query.eq('status', filter.status)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as InvoiceRow[]
  const invoices = await attachContext(rows)
  if (rows.length === 0) return []

  const paymentResult = await admin
    .from('billing_payments')
    .select('id, invoice_id, payment_group_id, amount, method, note, received_at, external_reference')
    .in('invoice_id', rows.map(row => row.id))
  if (paymentResult.error) throw new Error(paymentResult.error.message)

  return withBalances(
    invoices,
    (paymentResult.data ?? []) as InvoicePaymentRow[],
    firmTodayKey(now),
  )
}

/** One invoice with its frozen lines and its grouped payments. */
export async function fetchInvoice(
  invoiceId: string,
  now?: Date,
): Promise<InvoiceDetail | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  const row = data as InvoiceRow
  const [invoice] = await attachContext([row])

  const [lineResult, paymentResult] = await Promise.all([
    admin
      .from('invoice_items')
      .select('id, invoice_id, billing_item_id, position, kind, description, amount_cents')
      .eq('invoice_id', invoiceId)
      .order('position', { ascending: true }),
    admin
      .from('billing_payments')
      .select('id, invoice_id, payment_group_id, amount, method, note, received_at, external_reference')
      .eq('invoice_id', invoiceId),
  ])
  if (lineResult.error) throw new Error(lineResult.error.message)
  if (paymentResult.error) throw new Error(paymentResult.error.message)

  const payments = (paymentResult.data ?? []) as InvoicePaymentRow[]
  const collected = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const balance = Math.max(0, invoice.subtotalCents - collected)

  const lines: InvoiceLine[] = ((lineResult.data ?? []) as InvoiceItemRow[]).map(line => ({
    id: line.id,
    billingItemId: line.billing_item_id,
    position: line.position,
    kind: line.kind,
    description: line.description,
    amountCents: line.amount_cents,
  }))

  return {
    ...invoice,
    lines,
    payments: groupPayments(payments),
    collected,
    balance,
    ...invoiceOverdue(invoice, balance, firmTodayKey(now)),
  }
}

/**
 * Charges on a matter that can still go on an invoice: not already invoiced,
 * still owing, and not a plan claim — a claim is billed to the carrier.
 *
 * `draftInvoiceId` widens that to the charges a given draft already holds, so
 * its editor can show them ticked instead of hiding the very lines being
 * edited. Only ever a draft: an issued invoice's charges are frozen.
 */
export async function fetchInvoiceableCharges(
  matterId: string,
  draftInvoiceId?: string,
): Promise<InvoiceableCharge[]> {
  const admin = getAdminClient()
  // Filtered in memory rather than in the query: a matter carries a handful of
  // charges, and "unclaimed or claimed by this one draft" costs an interpolated
  // id in a PostgREST `or` for no meaningful saving.
  const { data, error } = await admin
    .from('billing_items')
    .select('id, kind, label, amount_billed, invoice_id, created_at')
    .eq('matter_id', matterId)
    .neq('kind', 'plan_claim')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  return ((data ?? []) as {
    id: string
    kind: BillingKind
    label: string
    amount_billed: number
    invoice_id: string | null
    created_at: string
  }[])
    .filter(row => row.invoice_id === null
      || (draftInvoiceId !== undefined && row.invoice_id === draftInvoiceId))
    .map(row => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      amountBilled: row.amount_billed,
      createdAt: row.created_at,
    }))
}
