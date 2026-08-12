import { z } from 'zod'

export const billingKinds = ['flat_fee', 'plan_claim', 'cost'] as const
export const billingPlans = ['metlife', 'legalease'] as const
export const billingStatuses = [
  'to_invoice',
  'invoiced',
  'claim_submitted',
  'partial',
  'paid',
] as const
export const billingPaymentMethods = ['check', 'card', 'ach', 'plan_eft', 'cash'] as const

export type BillingKind = (typeof billingKinds)[number]
export type BillingPlan = (typeof billingPlans)[number]
export type BillingStatus = (typeof billingStatuses)[number]
export type BillingPaymentMethod = (typeof billingPaymentMethods)[number]
export type BillingFilter = 'all' | 'open' | 'overdue' | 'paid'
export type RevenueCategory = 'trust' | 'will' | 'probate' | 'legal'

export interface BillingItem {
  id: string
  matterId: string
  kind: BillingKind
  label: string
  plan: BillingPlan | null
  amountBilled: number
  status: BillingStatus
  invoicedAt: string | null
  source: 'engagement' | 'manual' | 'workflow'
  lastRemindedAt: string | null
  createdAt: string
  clientName: string
  clientEmail: string | null
  matterNumber: string | null
  practiceArea: string | null
  planType: string | null
  legalPlan: string | null
}

export interface BillingPayment {
  id: string
  billingItemId: string
  amount: number
  method: BillingPaymentMethod
  note: string | null
  receivedAt: string
}

export interface BillingLedgerRow extends BillingItem {
  payments: BillingPayment[]
  collected: number
  balance: number
  ageDays: number
  overdue: boolean
  paidAt: string | null
}

export interface RevenueRollup {
  current: number
  prior: number
  count: number
}

export interface UnpreparedClaim {
  matterId: string
  clientName: string
  clientEmail: string | null
  matterNumber: string | null
  legalPlan: BillingPlan
}

export interface BillingNudge {
  key: string
  kind: 'invoice' | 'reminder' | 'claim'
  clientName: string
  description: string
  itemId: string | null
  matterId: string
  clientEmail: string | null
  legalPlan: BillingPlan | null
}

/** One bar of the six-month collections chart on the finance dashboard. */
export interface CollectionsPoint {
  /** YYYY-MM. */
  month: string
  /** Short month name, e.g. `Feb`. */
  label: string
  amount: number
}

/** A logged payment flattened with its client context for the activity table. */
export interface RecentPaymentRow {
  id: string
  billingItemId: string
  matterId: string
  clientName: string
  matterNumber: string | null
  label: string
  kind: BillingKind
  method: BillingPaymentMethod
  amount: number
  receivedAt: string
}

export interface BillingSnapshot {
  rows: BillingLedgerRow[]
  selectedMonth: string
  annualGoalCents: number
  revenue: Record<'total' | RevenueCategory, RevenueRollup>
  outstanding: { amount: number; openCount: number; overdueAmount: number }
  collectedMonth: { amount: number; priorAmount: number; deltaPercent: number | null }
  collectedYtd: { amount: number; goal: number; progressPercent: number }
  averageDaysToCollect: { all: number | null; flatFee: number | null; planClaim: number | null }
  aging: { current: number; days31To60: number; days61Plus: number }
  /** Six months of collections ending at `selectedMonth`, oldest first. */
  collectionsTrend: { points: CollectionsPoint[]; deltaPercent: number | null }
  /** Costs billed in the selected month — the firm's outlay, not its revenue. */
  costsMonth: { amount: number; priorAmount: number; deltaPercent: number | null }
  /** Work that is billable but not yet invoiced, plus what has aged past due. */
  pendingInvoices: { amount: number; count: number; overdueCount: number; overdueAmount: number }
  /** Most recent payments across every matter, newest first. */
  recentPayments: RecentPaymentRow[]
  openClaims: BillingLedgerRow[]
  unpreparedClaims: UnpreparedClaim[]
  nudges: BillingNudge[]
}

export const billingItemIdSchema = z.string().uuid()

export const logBillingPaymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(billingPaymentMethods),
  note: z.string().trim().max(500).nullable().optional(),
  receivedAt: z.string().datetime({ offset: true }).optional(),
})

/**
 * Kinds staff may add by hand, in the order the Add charge dropdown lists them.
 * A legal fee may be added even though the engagement also seeds one — the
 * seeded row is source='engagement' and a hand-added one is source='manual',
 * so they never collide.
 */
export const addableBillingKinds = ['flat_fee', 'plan_claim', 'cost'] as const
export type AddableBillingKind = (typeof addableBillingKinds)[number]

export const createBillingItemSchema = z
  .object({
    matterId: z.string().uuid(),
    kind: z.enum(addableBillingKinds),
    label: z.string().trim().min(1).max(200),
    amountBilled: z.number().int().positive(),
    plan: z.enum(billingPlans).nullable().optional(),
  })
  .refine(value => (value.kind === 'plan_claim') === Boolean(value.plan), {
    message: 'A plan claim requires a legal plan, and only a plan claim carries one',
    path: ['plan'],
  })

/**
 * The editable face of a charge. Same fields the Add charge dialog collects,
 * minus the matter — a charge moves to another matter by being deleted and
 * re-entered there, not by having its owner swapped underneath its payments.
 */
export const updateBillingItemSchema = z
  .object({
    kind: z.enum(addableBillingKinds),
    label: z.string().trim().min(1).max(200),
    amountBilled: z.number().int().positive(),
    plan: z.enum(billingPlans).nullable().optional(),
  })
  .refine(value => (value.kind === 'plan_claim') === Boolean(value.plan), {
    message: 'A plan claim requires a legal plan, and only a plan claim carries one',
    path: ['plan'],
  })

/**
 * Charges to delete in one call. Bounded so a runaway selection cannot ask the
 * database to lock the whole ledger in a single statement.
 */
export const deleteBillingItemsSchema = z.object({
  ids: z.array(billingItemIdSchema).min(1).max(100),
})

export const dismissBillingNudgeSchema = z.object({
  nudgeKey: z.string().trim().min(1).max(250),
  weekStart: z.string().date(),
})
