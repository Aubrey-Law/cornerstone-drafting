import 'server-only'
import { allAccountingRows } from '@/lib/queries/invoiceBalances'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { BillingFilter } from '@/lib/billing/types'
import { pageRequest, monthRange, type PageRequest, type PageResult } from '@/lib/queries/page'

import { buildBillingSnapshot, buildRows } from '@/lib/billing/metrics'
import type {
  BillingItem,
  BillingLedgerRow,
  BillingPayment,
  BillingPlan,
  BillingSnapshot,
  UnpreparedClaim,
} from '@/lib/billing/types'
import {
  billingMilestonesEnabled,
  fetchAttachableServicePackages,
  fetchMatterFeeSchedule,
  type MatterFeeScheduleView,
  type ServicePackageOption,
} from '@/lib/billing/schedules'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'

type BillingItemRow = {
  id: string
  matter_id: string
  kind: BillingItem['kind']
  label: string
  plan: BillingItem['plan']
  amount_billed: number
  status: BillingItem['status']
  invoiced_at: string | null
  source: BillingItem['source']
  last_reminded_at: string | null
  created_at: string
  invoice_id: string | null
}
type PaymentRow = {
  id: string
  billing_item_id: string
  amount: number
  method: BillingPayment['method']
  note: string | null
  received_at: string
  invoice_id: string | null
  payment_group_id: string | null
}

/** Just enough of an invoice to label a charge and decide whether it is late. */
type InvoiceContextRow = {
  id: string
  number: string | null
  due_date: string | null
  status: string
}

type MatterRow = {
  id: string
  matter_number: string | null
}

type PipelineRow = {
  matter_id: string
  client_name: string | null
  client_email: string | null
  matter_name: string | null
  practice_area: string | null
  plan_type: string | null
}

type DetailRow = {
  client_id: string
  practice_area: string | null
  plan_type: string | null
  legal_plan: string | null
  flat_fee_amount: number | null
  engagement_signed: boolean | null
  engagement_signed_at: string | null
}

function billingPlan(value: string | null): BillingPlan | null {
  const normalized = value?.toLowerCase().replace(/[\s_-]+/g, '') ?? ''
  if (normalized.includes('metlife')) return 'metlife'
  if (normalized.includes('legalease')) return 'legalease'
  return null
}

function currentWeekStart(now = new Date()): string {
  const today = firmTodayKey(now)
  const [year, month, day] = today.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday)
  return utc.toISOString().slice(0, 10)
}

export interface BillingMatterOption {
  hasLegalFee?: boolean
  id: string
  label: string
}

/**
 * Matters a charge can be added to, for the firm workspace's matter picker.
 * Covers every matter, not only those already carrying billing items.
 */
export async function fetchBillingMatterOptions(search='',selected?:string): Promise<BillingMatterOption[]> {
  if(search.length>200) throw new Error('Matter search is too long')
  const admin=getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
  const {data,error}=await admin.rpc('firm_billing_matter_options_v1',{p_search:search,...(selected ? {p_selected:selected} : {})})
  if(error || !data) throw new Error('Billing matter choices are unavailable')
  return data as unknown as BillingMatterOption[]
}

/** Joins a raw billing_items row to its matter context. Shared by both views. */
function mapBillingItem(
  row: BillingItemRow,
  context: {
    matter: MatterRow | null
    pipeline: PipelineRow | null
    details: DetailRow | null
    invoice?: InvoiceContextRow | null
  },
): BillingItem {
  const { matter, pipeline, details, invoice } = context
  return {
    id: row.id,
    matterId: row.matter_id,
    kind: row.kind,
    label: row.label,
    plan: row.plan,
    amountBilled: row.amount_billed,
    status: row.status,
    invoicedAt: row.invoiced_at,
    source: row.source,
    lastRemindedAt: row.last_reminded_at,
    createdAt: row.created_at,
    clientName: pipeline?.client_name ?? pipeline?.matter_name ?? 'Unknown client',
    clientEmail: pipeline?.client_email ?? null,
    matterNumber: matter?.matter_number ?? null,
    practiceArea: details?.practice_area ?? pipeline?.practice_area ?? null,
    planType: details?.plan_type ?? pipeline?.plan_type ?? null,
    legalPlan: details?.legal_plan ?? null,
    invoiceId: row.invoice_id,
    invoiceNumber: invoice?.number ?? null,
    // A void invoice stops governing the charge's due date; the charge is
    // released back to to_invoice and falls back to the legacy rule.
    invoiceDueOn: invoice && invoice.status !== 'void' ? invoice.due_date : null,
  }
}

export interface MatterBillingView {
  rows: BillingLedgerRow[]
  /** `matter_details.legal_plan` normalized, so the tab can nudge for a claim. */
  legalPlan: BillingPlan | null
  /** True once a plan claim exists, so the nudge stays hidden. */
  hasClaim: boolean
  /** The matter's agreed fee split into milestones, once one is attached. */
  feeSchedule: MatterFeeScheduleView | null
  /** False while milestone billing is off, which hides the whole card. */
  milestonesEnabled: boolean
  /** Packages offered to attach. Empty unless one can be attached right now. */
  servicePackages: ServicePackageOption[]
}

/**
 * One matter's billing rows, derived exactly as the firm ledger derives them.
 * Scoped at the database rather than by filtering the firm-wide snapshot.
 */
export async function fetchMatterBilling(
  matterId: string,
  now?: Date,
): Promise<MatterBillingView> {
  const admin = getAdminClient()
  // The schedule rides along with the ledger reads rather than following them,
  // so the tab still loads in one round trip.
  const [
    [milestonesEnabled, feeSchedule],
    itemResult,
    matterResult,
    pipelineResult,
    detailResult,
    invoiceResult,
  ] = await Promise.all([
    Promise.all([billingMilestonesEnabled(), fetchMatterFeeSchedule(matterId)]),
    admin
      .from('billing_items')
      .select('*')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: true }),
    admin.from('matters').select('id, matter_number').eq('id', matterId).maybeSingle(),
    admin
      .from('v_matter_pipeline')
      .select('matter_id, client_name, client_email, matter_name, practice_area, plan_type')
      .eq('matter_id', matterId)
      .maybeSingle(),
    admin
      .from('matter_details')
      .select(
        'client_id, practice_area, plan_type, legal_plan, flat_fee_amount, engagement_signed, engagement_signed_at',
      )
      .eq('client_id', matterId)
      .maybeSingle(),
    admin
      .from('invoices')
      .select('id, number, due_date, status')
      .eq('matter_id', matterId),
  ])

  const error = itemResult.error ?? matterResult.error ?? pipelineResult.error
    ?? detailResult.error ?? invoiceResult.error
  if (error) throw new Error(error.message)

  const invoiceById = new Map(
    ((invoiceResult.data ?? []) as InvoiceContextRow[]).map(invoice => [invoice.id, invoice]),
  )
  const itemRows = (itemResult.data ?? []) as BillingItemRow[]
  const details = (detailResult.data ?? null) as DetailRow | null
  const items = itemRows.map(row =>
    mapBillingItem(row, {
      matter: (matterResult.data ?? null) as MatterRow | null,
      pipeline: (pipelineResult.data ?? null) as PipelineRow | null,
      details,
      invoice: row.invoice_id ? invoiceById.get(row.invoice_id) ?? null : null,
    }),
  )

  const paymentResult = items.length
    ? await admin
      .from('billing_payments')
      .select('*')
      .in('billing_item_id', items.map(item => item.id))
      .order('received_at', { ascending: true })
    : { data: [], error: null }
  if (paymentResult.error) throw new Error(paymentResult.error.message)

  const payments = ((paymentResult.data ?? []) as PaymentRow[]).map((row): BillingPayment => ({
    id: row.id,
    billingItemId: row.billing_item_id,
    amount: row.amount,
    method: row.method,
    note: row.note,
    receivedAt: row.received_at,
    paymentGroupId: row.payment_group_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_id ? invoiceById.get(row.invoice_id)?.number ?? null : null,
  }))

  // `create_matter_fee_schedule` refuses a matter that already carries billing,
  // so packages are only worth offering when a schedule could actually attach.
  const canAttach = milestonesEnabled && !feeSchedule && items.length === 0
  const servicePackages = canAttach ? await fetchAttachableServicePackages() : []

  return {
    rows: buildRows(items, payments, firmTodayKey(now)),
    legalPlan: billingPlan(details?.legal_plan ?? null),
    hasClaim: items.some(item => item.kind === 'plan_claim'),
    feeSchedule,
    milestonesEnabled,
    servicePackages,
  }
}

async function completeBillingRows<T>(read:(offset:number)=>PromiseLike<{data:T[]|null;error:unknown}>):Promise<{data:T[];error:{message:string}|null}> {
  try { return {data:await allAccountingRows(read),error:null} }
  catch { return {data:[],error:{message:'Complete billing data is unavailable'}} }
}

export async function fetchBillingData(input: {
  userId: string
  selectedMonth: string
  now?: Date
}): Promise<{ snapshot: BillingSnapshot; error: string | null; weekStart: string }> {
  const admin = getAdminClient()
  const weekStart = currentWeekStart(input.now)
  const [
    itemResult,
    paymentResult,
    matterResult,
    pipelineResult,
    detailResult,
    settingsResult,
    dismissalResult,
    invoiceResult,
  ] = await Promise.all([
    completeBillingRows(offset=>admin.from('billing_items').select('*').order('id').range(offset,offset+999)),
    completeBillingRows(offset=>admin.from('billing_payments').select('*').order('id').range(offset,offset+999)),
    completeBillingRows(offset=>admin.from('matters').select('id, matter_number').order('id').range(offset,offset+999)),
    completeBillingRows(offset=>admin.from('v_matter_pipeline').select('matter_id, client_name, client_email, matter_name, practice_area, plan_type').order('matter_id').range(offset,offset+999)),
    completeBillingRows(offset=>admin.from('matter_details').select('client_id, practice_area, plan_type, legal_plan, flat_fee_amount, engagement_signed, engagement_signed_at').order('client_id').range(offset,offset+999)),
    admin
      .from('firm_settings')
      .select('billing_annual_goal_cents')
      .eq('id', 1)
      .maybeSingle(),
    admin
      .from('billing_nudge_dismissals')
      .select('nudge_key')
      .eq('user_id', input.userId)
      .eq('week_start', weekStart),
    completeBillingRows(offset=>admin.from('invoices').select('id, number, due_date, status').order('id').range(offset,offset+999)),
  ])

  const errors = [
    itemResult.error,
    paymentResult.error,
    matterResult.error,
    pipelineResult.error,
    detailResult.error,
    settingsResult.error,
    dismissalResult.error,
    invoiceResult.error,
  ].filter((error): error is NonNullable<typeof error> => Boolean(error))

  const matterById = new Map(
    ((matterResult.data ?? []) as MatterRow[]).map(matter => [matter.id, matter]),
  )
  const pipelineById = new Map(
    ((pipelineResult.data ?? []) as PipelineRow[]).map(matter => [matter.matter_id, matter]),
  )
  const detailById = new Map(
    ((detailResult.data ?? []) as DetailRow[]).map(detail => [detail.client_id, detail]),
  )
  const invoiceById = new Map(
    ((invoiceResult.data ?? []) as InvoiceContextRow[]).map(invoice => [invoice.id, invoice]),
  )

  const items = ((itemResult.data ?? []) as BillingItemRow[]).map(row =>
    mapBillingItem(row, {
      matter: matterById.get(row.matter_id) ?? null,
      pipeline: pipelineById.get(row.matter_id) ?? null,
      details: detailById.get(row.matter_id) ?? null,
      invoice: row.invoice_id ? invoiceById.get(row.invoice_id) ?? null : null,
    }),
  )

  const payments = ((paymentResult.data ?? []) as PaymentRow[]).map((row): BillingPayment => ({
    id: row.id,
    billingItemId: row.billing_item_id,
    amount: row.amount,
    method: row.method,
    note: row.note,
    receivedAt: row.received_at,
    paymentGroupId: row.payment_group_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_id ? invoiceById.get(row.invoice_id)?.number ?? null : null,
  }))

  const engagementRevenueItems = ((detailResult.data ?? []) as DetailRow[])
    .filter(
      detail =>
        detail.engagement_signed
        && detail.engagement_signed_at
        && typeof detail.flat_fee_amount === 'number'
        && detail.flat_fee_amount > 0,
    )
    .map((detail): BillingItem => {
      const matter = matterById.get(detail.client_id)
      const pipeline = pipelineById.get(detail.client_id)
      return {
        id: `engagement:${detail.client_id}`,
        matterId: detail.client_id,
        kind: 'flat_fee',
        label: 'Engagement fee',
        plan: null,
        amountBilled: Math.round(detail.flat_fee_amount! * 100),
        status: 'paid',
        invoicedAt: null,
        source: 'engagement',
        lastRemindedAt: null,
        createdAt: detail.engagement_signed_at!,
        clientName: pipeline?.client_name ?? pipeline?.matter_name ?? 'Unknown client',
        clientEmail: pipeline?.client_email ?? null,
        matterNumber: matter?.matter_number ?? null,
        practiceArea: detail.practice_area ?? pipeline?.practice_area ?? null,
        planType: detail.plan_type ?? pipeline?.plan_type ?? null,
        legalPlan: detail.legal_plan,
      }
    })

  const matterIdsWithClaims = new Set(
    items.filter(item => item.kind === 'plan_claim').map(item => item.matterId),
  )
  const unpreparedClaims = ((detailResult.data ?? []) as DetailRow[])
    .flatMap((detail): UnpreparedClaim[] => {
      const plan = billingPlan(detail.legal_plan)
      if (!detail.engagement_signed || !plan || matterIdsWithClaims.has(detail.client_id)) return []
      const matter = matterById.get(detail.client_id)
      const pipeline = pipelineById.get(detail.client_id)
      return [{
        matterId: detail.client_id,
        clientName: pipeline?.client_name ?? pipeline?.matter_name ?? 'Unknown client',
        clientEmail: pipeline?.client_email ?? null,
        matterNumber: matter?.matter_number ?? null,
        legalPlan: plan,
      }]
    })

  const annualGoal = Number(
    (settingsResult.data as { billing_annual_goal_cents?: number } | null)
      ?.billing_annual_goal_cents,
  )
  const snapshot = buildBillingSnapshot({
    items,
    payments,
    engagementRevenueItems,
    selectedMonth: input.selectedMonth,
    annualGoalCents: Number.isSafeInteger(annualGoal) && annualGoal > 0 ? annualGoal : 12_000_000,
    now: input.now,
    dismissedNudgeKeys: ((dismissalResult.data ?? []) as { nudge_key: string }[])
      .map(row => row.nudge_key),
    unpreparedClaims,
  })

  return {
    snapshot,
    error: errors.length > 0 ? errors.map(error => error.message).join(' — ') : null,
    weekStart,
  }
}

export type LedgerPageParams = PageRequest & { filter:BillingFilter; search:string; month:string }
export type LedgerPage = PageResult<BillingLedgerRow> & { counts:Record<BillingFilter,number> }
export async function fetchLedgerPage(params:LedgerPageParams):Promise<LedgerPage> {
  monthRange(params.month)
  if(!['all','open','overdue','paid','to_invoice'].includes(params.filter) || params.search.length>200) throw new Error('Invalid ledger filter')
  const admin=getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
  const {data,error}=await admin.rpc('firm_ledger_page_v1',{p_query:{...params,...pageRequest(params),today:firmTodayKey()}})
  if(error || !data) throw new Error('Billing ledger is temporarily unavailable. Please retry.')
  return data as unknown as LedgerPage
}
