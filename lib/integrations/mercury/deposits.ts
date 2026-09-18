import 'server-only'
import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { listMercuryTransactions } from './client'
import { getMercuryConfig, getMercuryConfigStatus } from './config'
import { toDeposit } from './normalize'
import { mercuryReference, proposeDepositMatches, type DepositProposal, type OpenInvoice } from './reconcile'

/**
 * Joins the two sides and hands them to the pure matcher.
 *
 * This is the only module that touches both Mercury and the database, which is
 * what keeps `reconcile.ts` free of I/O and therefore testable on fixtures.
 *
 * Nothing here writes. The proposals are derived on demand from live Mercury
 * data plus tables that already exist, so the whole feature is switched off by
 * unsetting one environment variable.
 */

const OPEN_STATUSES = ['issued', 'partial'] as const

export type MercuryDepositsView = {
  generatedAt: string
  window: { postedStart: string; postedEnd: string }
  summary: Record<'scanned' | 'ignored' | 'proposed' | 'ambiguous' | 'unmatched' | 'alreadyApplied', number>
  proposals: DepositProposal[]
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function loadOpenInvoices(): Promise<OpenInvoice[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select('id, matter_id, number, bill_to_name, issue_date, subtotal_cents, kind')
    .in('status', OPEN_STATUSES)
    .eq('kind', 'invoice')
  if (error) throw new Error('Open invoices are unavailable. Please retry.')

  const rows = data ?? []
  if (rows.length === 0) return []

  const matterIds = [...new Set(rows.map(row => row.matter_id))]
  const [balances, pipeline] = await Promise.all([
    loadInvoiceBalances(admin, rows.map(row => ({ id: row.id, subtotal_cents: row.subtotal_cents, kind: row.kind }))),
    admin.from('v_matter_pipeline').select('matter_id, client_name, matter_name').in('matter_id', matterIds),
  ])
  const clientByMatter = new Map(
    ((pipeline.data ?? []) as Array<{ matter_id: string; client_name: string | null; matter_name: string | null }>)
      .map(row => [row.matter_id, row.client_name ?? row.matter_name]),
  )

  return rows
    .map(row => ({
      invoiceId: row.id,
      number: row.number,
      matterId: row.matter_id,
      billToName: row.bill_to_name,
      clientName: clientByMatter.get(row.matter_id) ?? null,
      issueDate: row.issue_date,
      subtotalCents: row.subtotal_cents,
      balanceCents: balances.get(row.id) ?? 0,
    }))
    // A fully-settled invoice still sitting in `issued` has nothing left to pay.
    .filter(invoice => invoice.balanceCents > 0)
}

/**
 * Mercury references already recorded against a payment.
 *
 * Read from the ledger rather than stored separately, so an applied deposit
 * stops being offered without this feature owning any state of its own.
 */
async function loadAppliedReferences(): Promise<ReadonlySet<string>> {
  const { data, error } = await getAdminClient()
    .from('billing_payments')
    .select('external_reference')
    .like('external_reference', 'mercury:%')
  if (error) throw new Error('Recorded payments are unavailable. Please retry.')
  return new Set((data ?? []).map(row => row.external_reference).filter((ref): ref is string => typeof ref === 'string'))
}

export function isMercuryConfigured(): boolean {
  const status = getMercuryConfigStatus()
  return status.tokenConfigured && status.baseUrlValid
}

export async function loadMercuryDepositProposals(
  options: { days?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<MercuryDepositsView> {
  const { incomeAccountIds } = getMercuryConfig()
  const days = options.days ?? 30
  const now = new Date()
  const start = new Date(now.getTime() - days * 86_400_000)
  const window = { postedStart: dayKey(start), postedEnd: dayKey(now) }

  const [transactions, invoices, appliedReferences] = await Promise.all([
    listMercuryTransactions({ ...window, limit: options.limit ?? 200 }, options.signal),
    loadOpenInvoices(),
    loadAppliedReferences(),
  ])

  const proposals = proposeDepositMatches({
    deposits: transactions.map(toDeposit),
    invoices,
    incomeAccountIds,
    appliedReferences,
  })

  return {
    generatedAt: now.toISOString(),
    window,
    summary: {
      scanned: proposals.length,
      ignored: proposals.filter(row => row.status === 'ignored').length,
      proposed: proposals.filter(row => row.status === 'proposed').length,
      ambiguous: proposals.filter(row => row.status === 'ambiguous').length,
      unmatched: proposals.filter(row => row.status === 'unmatched').length,
      alreadyApplied: proposals.filter(row => row.status === 'already_applied').length,
    },
    proposals,
  }
}

export { mercuryReference }
