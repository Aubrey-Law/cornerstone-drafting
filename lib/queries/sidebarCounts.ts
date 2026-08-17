import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchInboxNeedsReplyCount } from '@/lib/queries/inbox'
import { fetchMatterAgingTiles } from '@/lib/queries/pipelineAging'
import { fetchTaskCounts } from '@/lib/queries/tasks'
import { type SidebarCounts } from '@/lib/sidebarBadges'

interface CountResult {
  count: number | null
  error: { message: string } | null
}

function countOrZero(result: CountResult, label: string): number {
  if (result.error) {
    console.error(`sidebar counts ${label} error:`, result.error)
    return 0
  }
  return result.count ?? 0
}

export async function fetchSidebarCounts(): Promise<SidebarCounts> {
  const admin = getAdminClient()

  const [intakeReview, openMattersRes] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id', { count: 'exact', head: true })
      .eq('stage', 'intake_review'),
    admin
      .from('v_matter_pipeline')
      .select('matter_id')
      .neq('stage', 'closed'),
  ])

  const intakeReviewCount = countOrZero(intakeReview, 'intake review')

  let draftingNeedsDesignCount = 0
  const openMatterIds = ((openMattersRes.data ?? []) as Array<{ matter_id: string }>).map(row => row.matter_id)
  if (openMattersRes.error) {
    console.error('sidebar counts open matters error:', openMattersRes.error)
  } else if (openMatterIds.length > 0) {
    const { data: designSheets, error: designSheetsError } = await admin
      .from('design_sheets')
      .select('matter_id')
      .in('matter_id', openMatterIds)

    if (designSheetsError) {
      console.error('sidebar counts design sheets error:', designSheetsError)
    } else {
      const mattersWithDesign = new Set(
        ((designSheets ?? []) as Array<{ matter_id: string }>).map(row => row.matter_id),
      )
      draftingNeedsDesignCount = openMatterIds.filter(id => !mattersWithDesign.has(id)).length
    }
  }

  let agingRedCount = 0
  let agingAmberCount = 0
  try {
    const tiles = await fetchMatterAgingTiles()
    agingRedCount = tiles.red
    agingAmberCount = tiles.amber
  } catch (error) {
    console.error('sidebar counts aging error:', error)
  }

  let tasksOverdueCount = 0
  try {
    tasksOverdueCount = (await fetchTaskCounts()).overdue
  } catch (error) {
    console.error('sidebar counts tasks error:', error)
  }

  let inboxNeedsReplyCount = 0
  try {
    inboxNeedsReplyCount = await fetchInboxNeedsReplyCount()
  } catch (error) {
    console.error('sidebar counts inbox error:', error)
  }

  let overdueInvoiceCount = 0
  try {
    overdueInvoiceCount = await fetchOverdueInvoiceCount()
  } catch (error) {
    console.error('sidebar counts billing error:', error)
  }

  return {
    inboxNeedsReplyCount,
    intakeReviewCount,
    draftingNeedsDesignCount,
    agingRedCount,
    agingAmberCount,
    tasksOverdueCount,
    overdueInvoiceCount,
  }
}

/**
 * Issued invoices past their due date that still owe something.
 *
 * Counted here rather than reusing the Today query because the badge only
 * needs a number, and the payment join is what makes that query expensive.
 */
async function fetchOverdueInvoiceCount(): Promise<number> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select('id, subtotal_cents')
    .in('status', ['issued', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', firmTodayKey())
  if (error || !data || data.length === 0) return 0

  const invoices = data as { id: string; subtotal_cents: number }[]
  const { data: payments } = await admin
    .from('billing_payments')
    .select('invoice_id, amount')
    .in('invoice_id', invoices.map(invoice => invoice.id))

  const collected = new Map<string, number>()
  for (const payment of (payments ?? []) as { invoice_id: string; amount: number }[]) {
    collected.set(payment.invoice_id, (collected.get(payment.invoice_id) ?? 0) + payment.amount)
  }
  return invoices.filter(
    invoice => invoice.subtotal_cents - (collected.get(invoice.id) ?? 0) > 0,
  ).length
}
