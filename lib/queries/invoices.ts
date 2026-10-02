import 'server-only'
import { pageRequest, monthRange, type PageRequest, type PageResult } from '@/lib/queries/page'
import { allAccountingRows, loadInvoiceAccounting } from '@/lib/queries/invoiceBalances'

import {
  invoiceOverdue,
  type Invoice,
  type InvoiceDetail,
  type InvoiceLine,
  type InvoicePaymentGroup,
  type InvoicePayer,
  type InvoiceStatus,
  type InvoiceableCharge,
} from '@/lib/billing/invoices'
import type { BillingKind, BillingPaymentMethod, BillingPlan } from '@/lib/billing/types'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'

type InvoiceRow = {
  id: string
  matter_id: string
  number: string | null
  number_year: number | null
  kind: 'invoice' | 'credit_note'
  status: InvoiceStatus
  /** Absent only before the 20270103090000 migration lands. */
  payer?: InvoicePayer | null
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
    payer: row.payer ?? 'client',
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

export const invoiceQueueFilters = ['attention', 'draft', 'due_soon', 'past_due', 'paid', 'all'] as const
export type InvoiceQueueFilter = (typeof invoiceQueueFilters)[number]
export type InvoiceQueueCounts = Record<InvoiceQueueFilter, number>

const invoiceSearchLimit = 500

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function invoiceSearchPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, value => `\\${value}`)}%`
}

async function resolveInvoiceSearchIds(search: string): Promise<string[] | null> {
  const value = search.trim()
  if (!value) return null
  if (value.length > 200) throw new Error('Invoice search is too long')

  const admin = getAdminClient()
  const pattern = invoiceSearchPattern(value)
  const [numberResult, billToResult, matterNumberResult, clientResult, matterNameResult] = await Promise.all([
    admin.from('invoices').select('id').ilike('number', pattern).limit(invoiceSearchLimit + 1),
    admin.from('invoices').select('id').ilike('bill_to_name', pattern).limit(invoiceSearchLimit + 1),
    admin.from('matters').select('id').ilike('matter_number', pattern).limit(invoiceSearchLimit + 1),
    admin.from('v_matter_pipeline').select('matter_id').ilike('client_name', pattern).limit(invoiceSearchLimit + 1),
    admin.from('v_matter_pipeline').select('matter_id').ilike('matter_name', pattern).limit(invoiceSearchLimit + 1),
  ])
  const results = [numberResult, billToResult, matterNumberResult, clientResult, matterNameResult]
  const error = results.find(result => result.error)?.error
  if (error) throw new Error('Invoice search is temporarily unavailable')
  if (results.some(result => (result.data?.length ?? 0) > invoiceSearchLimit)) {
    throw new Error('Too many invoice search matches. Please narrow the search.')
  }

  const invoiceIds = new Set([
    ...((numberResult.data ?? []) as { id: string }[]).map(row => row.id),
    ...((billToResult.data ?? []) as { id: string }[]).map(row => row.id),
  ])
  const matterIds = [...new Set([
    ...((matterNumberResult.data ?? []) as { id: string }[]).map(row => row.id),
    ...((clientResult.data ?? []) as { matter_id: string }[]).map(row => row.matter_id),
    ...((matterNameResult.data ?? []) as { matter_id: string }[]).map(row => row.matter_id),
  ])]
  if (matterIds.length > 0) {
    const matterInvoiceResult = await admin
      .from('invoices')
      .select('id')
      .in('matter_id', matterIds)
      .limit(invoiceSearchLimit + 1)
    if (matterInvoiceResult.error) throw new Error('Invoice search is temporarily unavailable')
    if ((matterInvoiceResult.data?.length ?? 0) > invoiceSearchLimit) {
      throw new Error('Too many invoice search matches. Please narrow the search.')
    }
    for (const row of (matterInvoiceResult.data ?? []) as { id: string }[]) invoiceIds.add(row.id)
  }
  return [...invoiceIds]
}

type InvoiceFilterQuery = {
  eq(column: string, value: unknown): InvoiceFilterQuery
  in(column: string, values: readonly unknown[]): InvoiceFilterQuery
  gte(column: string, value: unknown): InvoiceFilterQuery
  lt(column: string, value: unknown): InvoiceFilterQuery
  lte(column: string, value: unknown): InvoiceFilterQuery
}

function applyInvoiceQueue(
  query: InvoiceFilterQuery,
  queue: InvoiceQueueFilter,
  today: string,
): InvoiceFilterQuery {
  const scoped = queue === 'all' ? query : query.eq('kind', 'invoice')
  if (queue === 'attention') return scoped.in('status', ['draft', 'issued', 'partial'])
  if (queue === 'draft') return scoped.eq('status', 'draft')
  if (queue === 'due_soon') {
    return scoped
      .in('status', ['issued', 'partial'])
      .gte('due_date', today)
      .lte('due_date', addCalendarDays(today, 14))
  }
  if (queue === 'past_due') {
    return scoped.in('status', ['issued', 'partial']).lt('due_date', today)
  }
  if (queue === 'paid') return scoped.eq('status', 'paid')
  return scoped
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
  if (rows.length === 0) return []
  const [invoices, accounting] = await Promise.all([attachContext(rows), loadInvoiceAccounting(admin, rows)])
  return invoices.map(invoice => {
    const { balance, collected } = accounting.get(invoice.id)!
    return { ...invoice, balance, collected, ...invoiceOverdue(invoice, balance, firmTodayKey(now)) }
  })
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

  const [lineResult, payments, accounting] = await Promise.all([
    admin
      .from('invoice_items')
      .select('id, invoice_id, billing_item_id, position, kind, description, amount_cents')
      .eq('invoice_id', invoiceId)
      .order('position', { ascending: true }),
    allAccountingRows<InvoicePaymentRow>(offset => admin.from('billing_payments')
      .select('id, invoice_id, payment_group_id, amount, method, note, received_at, external_reference')
      .eq('invoice_id', invoiceId).order('id').range(offset, offset + 999)),
    loadInvoiceAccounting(admin, [row]),
  ])
  if (lineResult.error) throw new Error(lineResult.error.message)
  const { balance, collected } = accounting.get(invoice.id)!

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
  //
  // Plan claims are included: they go on an invoice billed to their carrier.
  // The composer keeps one payer per invoice, and so does the database.
  const { data, error } = await admin
    .from('billing_items')
    .select('id, kind, plan, label, amount_billed, status, invoice_id, created_at')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  return ((data ?? []) as {
    id: string
    kind: BillingKind
    plan: BillingPlan | null
    label: string
    amount_billed: number
    status: string
    invoice_id: string | null
    created_at: string
  }[])
    .filter(row => row.invoice_id === null
      || (draftInvoiceId !== undefined && row.invoice_id === draftInvoiceId))
    // A claim the carrier has already paid through the per-claim path holds
    // its payment off any invoice; billing it again would show the carrier
    // owing money it has paid.
    .filter(row => row.kind !== 'plan_claim' || row.invoice_id !== null
      || (row.status !== 'paid' && row.status !== 'partial'))
    .map(row => ({
      id: row.id,
      kind: row.kind,
      plan: row.kind === 'plan_claim' ? row.plan : null,
      label: row.label,
      amountBilled: row.amount_billed,
      createdAt: row.created_at,
    }))
}

export type InvoicePageQuery = PageRequest & {
  matterId?: string
  status?: InvoiceStatus
  issueMonth?: string
  queue?: InvoiceQueueFilter
  search?: string
}
export type InvoicePageResult = PageResult<InvoiceListRow> & { counts: InvoiceQueueCounts }

export async function fetchInvoicePage(input: InvoicePageQuery, now?: Date): Promise<InvoicePageResult> {
  const page = pageRequest(input)
  if (input.status && !['draft','issued','partial','paid','void'].includes(input.status)) throw new Error('Invalid invoice status')
  const legacyStatus = input.queue === undefined ? input.status : undefined
  const queue: InvoiceQueueFilter = input.queue ?? (legacyStatus ? 'all' : 'attention')
  if (!invoiceQueueFilters.includes(queue as InvoiceQueueFilter)) throw new Error('Invalid invoice queue')
  const today = firmTodayKey(now)
  const admin = getAdminClient()
  const searchIds = await resolveInvoiceSearchIds(input.search ?? '')
  const issueRange = input.issueMonth ? monthRange(input.issueMonth) : null

  function applyScope(query: InvoiceFilterQuery): InvoiceFilterQuery {
    let scoped = query
    if (input.matterId) scoped = scoped.eq('matter_id', input.matterId)
    if (legacyStatus) scoped = scoped.eq('status', legacyStatus)
    if (searchIds) scoped = scoped.in('id', searchIds)
    if (issueRange) scoped = scoped.gte('issue_date', issueRange.from).lt('issue_date', issueRange.to)
    return scoped
  }

  const countedFilters = invoiceQueueFilters.filter(filter => filter !== 'attention')
  const countEntries = await Promise.all(countedFilters.map(async filter => {
    let countQuery = admin.from('invoices').select('id', { count: 'exact', head: true })
    countQuery = applyInvoiceQueue(
      applyScope(countQuery as unknown as InvoiceFilterQuery),
      filter,
      today,
    ) as unknown as typeof countQuery
    const { count, error } = await countQuery
    if (error || count === null) throw new Error('Invoice register is temporarily unavailable')
    return [filter, count] as const
  }))
  const counts = Object.fromEntries(countEntries) as Omit<InvoiceQueueCounts, 'attention'> & { attention?: number }
  counts.attention = counts.past_due + counts.due_soon + counts.draft
  const completeCounts = counts as InvoiceQueueCounts

  const total = completeCounts[queue]
  const lastPage = Math.max(1, Math.ceil(total / page.pageSize))
  if (page.page > lastPage) return fetchInvoicePage({ ...input, page:lastPage }, now)
  if (total === 0) return { ...page, total, rows: [], counts: completeCounts }

  const offset = (page.page - 1) * page.pageSize

  async function fetchRows(filter: InvoiceQueueFilter, from: number, size: number): Promise<InvoiceRow[]> {
    let query = admin.from('invoices').select('*')
    query = applyInvoiceQueue(
      applyScope(query as unknown as InvoiceFilterQuery),
      filter,
      today,
    ) as unknown as typeof query
    if (filter === 'due_soon' || filter === 'past_due') {
      query = query.order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
    } else if (filter === 'draft') {
      query = query.order('created_at', { ascending: true })
    } else {
      query = query.order('created_at', { ascending: false })
    }
    const { data, error } = await query
      .order('id', { ascending: false })
      .range(from, from + size - 1)
    if (error) throw new Error('Invoice register is temporarily unavailable')
    return (data ?? []) as InvoiceRow[]
  }

  let raw: InvoiceRow[]
  if (queue === 'attention') {
    const segments: { filter: InvoiceQueueFilter; from: number; size: number }[] = []
    let skipped = offset
    let remaining = page.pageSize
    for (const filter of ['past_due', 'due_soon', 'draft'] as const) {
      const count = completeCounts[filter]
      if (skipped >= count) {
        skipped -= count
        continue
      }
      const size = Math.min(remaining, count - skipped)
      if (size > 0) segments.push({ filter, from: skipped, size })
      remaining -= size
      skipped = 0
      if (remaining === 0) break
    }
    raw = (await Promise.all(segments.map(segment =>
      fetchRows(segment.filter, segment.from, segment.size),
    ))).flat()
  } else {
    raw = await fetchRows(queue, offset, page.pageSize)
  }
  const [invoices, accounting] = await Promise.all([attachContext(raw), loadInvoiceAccounting(admin, raw)])
  return { ...page, total, counts: completeCounts, rows:invoices.map(invoice => {
    const { balance, collected } = accounting.get(invoice.id)!
    return { ...invoice, balance, collected, ...invoiceOverdue(invoice,balance,today) }
  }) }
}
