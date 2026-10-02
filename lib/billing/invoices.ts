import { z } from 'zod'
import {
  billingPaymentMethods,
  type BillingKind,
  type BillingPlan,
} from './types'

/**
 * An invoice is the bill a client receives. A billing_item is a single charge.
 * One invoice groups several charges on a matter, so a flat fee plus two
 * recording costs arrive as one document rather than three.
 *
 * Money is integer cents throughout, matching the rest of the billing
 * subsystem. Overdue is derived from `dueDate`, never stored.
 */
export const invoiceStatuses = ['draft', 'issued', 'partial', 'paid', 'void'] as const
export type InvoiceStatus = (typeof invoiceStatuses)[number]

export const invoiceKinds = ['invoice', 'credit_note'] as const
export type InvoiceKind = (typeof invoiceKinds)[number]

/**
 * Who an invoice bills. A plan claim bills its carrier; every other charge
 * bills the client, and one invoice holds one payer. Derived from the charges
 * by the database (billing_item_payer), never chosen.
 *
 * A carrier invoice is the firm's own record of claims billed to the plan: it
 * is never emailed, shown in the portal, offered for checkout or reminded.
 */
export const invoicePayers = ['client', 'metlife', 'legalease'] as const
export type InvoicePayer = (typeof invoicePayers)[number]

export const invoicePayerLabels: Record<InvoicePayer, string> = {
  client: 'Client',
  metlife: 'MetLife Legal Plans',
  legalease: 'LegalEASE',
}

/** Mirrors public.billing_item_payer. */
export function chargePayer(charge: { kind: BillingKind; plan: BillingPlan | null }): InvoicePayer {
  return charge.kind === 'plan_claim' && charge.plan ? charge.plan : 'client'
}

/** A row read before the payer column existed counts as a client invoice. */
export function isCarrierInvoice(invoice: { payer?: InvoicePayer | null }): boolean {
  return invoice.payer === 'metlife' || invoice.payer === 'legalease'
}

/**
 * Payment terms offered in the composer. These are presentation only — the
 * database stores the resolved `dueDate`, so changing this list never
 * reinterprets an invoice that has already gone out.
 */
export const invoiceTerms = ['due_on_receipt', 'net_15', 'net_30', 'net_60'] as const
export type InvoiceTerm = (typeof invoiceTerms)[number]

export const invoiceTermLabels: Record<InvoiceTerm, string> = {
  due_on_receipt: 'Due on receipt',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_60: 'Net 60',
}

const invoiceTermDays: Record<InvoiceTerm, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_60: 60,
}

/**
 * Resolves a term against an issue date, both as YYYY-MM-DD firm-local keys.
 * Calendar arithmetic in UTC so a daylight-saving boundary cannot shift the
 * due date by a day.
 */
export function resolveDueDate(issueDateKey: string, term: InvoiceTerm): string {
  const [year, month, day] = issueDateKey.split('-').map(Number)
  const due = new Date(Date.UTC(year, month - 1, day))
  due.setUTCDate(due.getUTCDate() + invoiceTermDays[term])
  return due.toISOString().slice(0, 10)
}

/** The term a stored issue/due pair came from, or null when it matches none. */
export function inferTerm(issueDateKey: string | null, dueDateKey: string | null): InvoiceTerm | null {
  if (!issueDateKey || !dueDateKey) return null
  return invoiceTerms.find(term => resolveDueDate(issueDateKey, term) === dueDateKey) ?? null
}

/** A frozen line on the invoice. Snapshotted at compose time, never re-read. */
export interface InvoiceLine {
  id: string
  billingItemId: string | null
  position: number
  kind: BillingKind
  description: string
  amountCents: number
}

export interface InvoicePaymentGroup {
  paymentGroupId: string
  amount: number
  method: (typeof billingPaymentMethods)[number]
  note: string | null
  receivedAt: string
  externalReference: string | null
}

export interface Invoice {
  id: string
  matterId: string
  number: string | null
  numberYear: number | null
  kind: InvoiceKind
  status: InvoiceStatus
  payer: InvoicePayer
  subtotalCents: number
  issueDate: string | null
  dueDate: string | null
  notes: string | null
  terms: string | null
  billToName: string | null
  billToEmail: string | null
  paymentLink: string | null
  issuedAt: string | null
  sentAt: string | null
  lastRemindedAt: string | null
  paidAt: string | null
  voidedAt: string | null
  voidReason: string | null
  pdfDocumentId: string | null
  docxDocumentId: string | null
  createdAt: string
  /** Matter context, joined for display. */
  clientName: string
  clientEmail: string | null
  matterNumber: string | null
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[]
  payments: InvoicePaymentGroup[]
  collected: number
  balance: number
  /** True once the due date has passed with a balance outstanding. */
  overdue: boolean
  daysPastDue: number
}

/** A charge eligible to go on an invoice, for the composer's picker. */
export interface InvoiceableCharge {
  id: string
  kind: BillingKind
  /** The carrier a plan claim bills; null for client charges. */
  plan: BillingPlan | null
  label: string
  amountBilled: number
  createdAt: string
}

// ── Derivations ─────────────────────────────────────────────────────────────

/** Whole calendar days between two YYYY-MM-DD keys. Negative when `to` is earlier. */
function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  )
}

/**
 * An invoice is overdue when it still owes money the day after its due date.
 * A void or draft invoice is never overdue, and neither is one paid in full.
 */
export function invoiceOverdue(
  invoice: Pick<Invoice, 'status' | 'dueDate'>,
  balance: number,
  todayKey: string,
): { overdue: boolean; daysPastDue: number } {
  if (balance <= 0) return { overdue: false, daysPastDue: 0 }
  if (invoice.status === 'draft' || invoice.status === 'void') {
    return { overdue: false, daysPastDue: 0 }
  }
  if (!invoice.dueDate) return { overdue: false, daysPastDue: 0 }
  const days = calendarDaysBetween(invoice.dueDate, todayKey)
  return days > 0 ? { overdue: true, daysPastDue: days } : { overdue: false, daysPastDue: 0 }
}

export interface InvoiceTotals {
  subtotalCents: number
  lineCount: number
}

export interface InvoiceBalanceAdjustment {
  invoice_id: string
  amount_cents: number
  balance_effect: 'credit' | 'debit'
}

/** Credits reduce what is owed; refunds, chargebacks, and corrections can restore it. */
export function adjustedInvoiceBalance(
  subtotalCents: number,
  collectedCents: number,
  adjustments: Pick<InvoiceBalanceAdjustment, 'amount_cents' | 'balance_effect'>[] = [],
): number {
  const adjustment = adjustments.reduce(
    (sum, row) => sum + (row.balance_effect === 'credit' ? -row.amount_cents : row.amount_cents),
    0,
  )
  return Math.max(0, subtotalCents - collectedCents + adjustment)
}

/**
 * The composer's live preview total. Pure and synchronous so typing stays
 * instant — the server route exists only for the first paint.
 */
export function invoiceTotals(charges: Pick<InvoiceableCharge, 'amountBilled'>[]): InvoiceTotals {
  return {
    subtotalCents: charges.reduce((sum, charge) => sum + charge.amountBilled, 0),
    lineCount: charges.length,
  }
}

/** Presentation for an invoice status chip, mirroring billingStatusPresentation. */
export function invoiceStatusPresentation(
  invoice: Pick<Invoice, 'status'>,
  overdue: boolean,
): { label: string; tone: 'neutral' | 'invoiced' | 'partial' | 'paid' | 'overdue' | 'void' } {
  if (invoice.status === 'void') return { label: 'Void', tone: 'void' }
  if (invoice.status === 'paid') return { label: 'Paid', tone: 'paid' }
  if (overdue) return { label: 'Overdue', tone: 'overdue' }
  if (invoice.status === 'partial') return { label: 'Partly paid', tone: 'partial' }
  if (invoice.status === 'issued') return { label: 'Sent', tone: 'invoiced' }
  return { label: 'Draft', tone: 'neutral' }
}

// ── Request schemas ─────────────────────────────────────────────────────────

export const invoiceIdSchema = z.string().uuid()

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

const draftBodyShape = {
  itemIds: z.array(z.string().uuid()).min(1).max(100),
  issueDate: dateKeySchema,
  dueDate: dateKeySchema,
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  billToName: z.string().trim().min(1).max(200).nullable().optional(),
  billToEmail: z.string().trim().email().nullable().optional(),
  paymentLink: z.string().trim().url().max(500).nullable().optional(),
}

const dueAfterIssue = <T extends { issueDate: string; dueDate: string }>(value: T) =>
  value.dueDate >= value.issueDate

export const createInvoiceDraftSchema = z
  .object({ matterId: z.string().uuid(), ...draftBodyShape })
  .refine(dueAfterIssue, {
    message: 'Due date cannot precede the issue date',
    path: ['dueDate'],
  })

export const updateInvoiceDraftSchema = z
  .object(draftBodyShape)
  .refine(dueAfterIssue, {
    message: 'Due date cannot precede the issue date',
    path: ['dueDate'],
  })

/**
 * Issue-and-send in one action is the common case; `send: false` is the escape
 * hatch for an invoice that will be handed over in person.
 */
export const issueInvoiceSchema = z.object({
  send: z.boolean().default(true),
  to: z.string().trim().email().optional(),
  cc: z.array(z.string().trim().email()).max(5).optional(),
  message: z.string().trim().max(4000).optional(),
})

export const sendInvoiceSchema = z.object({
  to: z.string().trim().email(),
  cc: z.array(z.string().trim().email()).max(5).optional(),
  message: z.string().trim().max(4000).optional(),
})

/** Reuses billingPaymentMethods so there is one method enum, not two. */
export const recordInvoicePaymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(billingPaymentMethods),
  note: z.string().trim().max(500).nullable().optional(),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  externalReference: z.string().trim().max(200).nullable().optional(),
})

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

export const invoiceReminderSchema = z.object({
  tone: z.enum(['friendly', 'firm', 'final']).default('friendly'),
  attachInvoice: z.boolean().default(true),
  message: z.string().trim().max(4000).optional(),
})

/**
 * Bill several matters in one pass from a ledger selection.
 *
 * The route groups by matter server-side rather than trusting the client to:
 * an invoice belongs to exactly one matter, and that rule should not depend on
 * how the caller happened to slice the selection.
 */
export const batchInvoiceSchema = z
  .object({
    itemIds: z.array(z.string().uuid()).min(1).max(200),
    issueDate: dateKeySchema,
    dueInDays: z.number().int().min(0).max(180).default(30),
    terms: z.string().trim().max(2000).nullable().optional(),
  })

export type BatchInvoiceInput = z.infer<typeof batchInvoiceSchema>

/** One matter's worth of a batch, as the dialog previews it and the route creates it. */
export interface BatchInvoiceGroup {
  matterId: string
  clientName: string
  matterNumber: string | null
  chargeCount: number
  subtotalCents: number
}

export interface BatchInvoiceSkip {
  matterId: string
  clientName: string
  reason: string
}

export interface BatchInvoiceResult {
  created: { invoiceId: string; matterId: string; subtotalCents: number }[]
  skipped: BatchInvoiceSkip[]
}

/**
 * Splits a ledger selection into the invoices it would produce and the rows
 * that cannot go on one. Pure, so the dialog can preview the exact grouping the
 * route will perform without a round trip.
 */
export function planBatchInvoices(
  rows: {
    id: string
    matterId: string
    clientName: string
    matterNumber: string | null
    kind: string
    amountBilled: number
    balance: number
    invoiceId?: string | null
  }[],
): { groups: (BatchInvoiceGroup & { itemIds: string[] })[]; skipped: BatchInvoiceSkip[] } {
  const groups = new Map<string, BatchInvoiceGroup & { itemIds: string[] }>()
  const skipped: BatchInvoiceSkip[] = []
  const seenSkip = new Set<string>()

  const skip = (row: { matterId: string; clientName: string }, reason: string) => {
    const key = `${row.matterId}:${reason}`
    if (seenSkip.has(key)) return
    seenSkip.add(key)
    skipped.push({ matterId: row.matterId, clientName: row.clientName, reason })
  }

  for (const row of rows) {
    if (row.kind === 'plan_claim') {
      skip(row, 'Legal plan claims are billed to the carrier')
      continue
    }
    if (row.invoiceId) {
      skip(row, 'Already on an invoice')
      continue
    }
    if (row.balance <= 0) {
      skip(row, 'Nothing left to bill')
      continue
    }
    const existing = groups.get(row.matterId)
    if (existing) {
      existing.itemIds.push(row.id)
      existing.chargeCount += 1
      existing.subtotalCents += row.amountBilled
    } else {
      groups.set(row.matterId, {
        matterId: row.matterId,
        clientName: row.clientName,
        matterNumber: row.matterNumber,
        chargeCount: 1,
        subtotalCents: row.amountBilled,
        itemIds: [row.id],
      })
    }
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName)),
    skipped,
  }
}

/** Unpersisted preview for the composer's first paint. */
export const previewInvoiceSchema = z.object({
  matterId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(100),
  issueDate: dateKeySchema,
  dueDate: dateKeySchema,
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
})

export type CreateInvoiceDraftInput = z.infer<typeof createInvoiceDraftSchema>
export type UpdateInvoiceDraftInput = z.infer<typeof updateInvoiceDraftSchema>
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>
export type RecordInvoicePaymentInput = z.infer<typeof recordInvoicePaymentSchema>

