import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterAgingTiles } from '@/lib/queries/pipelineAging'
import { fetchTaskCounts } from '@/lib/queries/tasks'
import { type SidebarCounts } from '@/lib/sidebarBadges'

export async function fetchSidebarCounts(): Promise<SidebarCounts> {
  const admin = getAdminClient()
  const errors: string[] = []
  async function count(read: PromiseLike<{ count: number | null; error: unknown }>) {
    const result = await read
    if (result.error) throw new Error('Count unavailable')
    return result.count ?? 0
  }
  async function section<T>(key: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try { return await read() } catch { errors.push(key); return fallback }
  }
  const [intakeReviewCount, draftingNeedsDesignCount, aging, tasksOverdueCount, inboxNeedsReplyCount, emailTriageNeedsReplyCount, overdueInvoiceCount] = await Promise.all([
    section('intakeReviewCount', () => count(admin.from('v_matter_pipeline').select('matter_id', { count: 'exact', head: true }).eq('stage', 'intake_review')), 0),
    section('draftingNeedsDesignCount', async () => {
      const open = await admin.from('v_matter_pipeline').select('matter_id').neq('stage', 'closed')
      if (open.error) throw new Error('Matters unavailable')
      const ids = (open.data ?? []).map(row => row.matter_id)
      if (!ids.length) return 0
      const sheets = await admin.from('design_sheets').select('matter_id').in('matter_id', ids)
      if (sheets.error) throw new Error('Design sheets unavailable')
      const present = new Set((sheets.data ?? []).map(row => row.matter_id))
      return ids.filter(id => !present.has(id)).length
    }, 0),
    section('aging', async () => { const { red, amber } = await fetchMatterAgingTiles(); return { red, amber } }, { red: 0, amber: 0 }),
    section('tasksOverdueCount', async () => (await fetchTaskCounts()).overdue, 0),
    // Secure client messages remain actionable on Today after Inbox retirement.
    section('inboxNeedsReplyCount', () => count(admin.from('messages').select('id', { count: 'exact', head: true }).eq('sender_role', 'client').is('read_at', null)), 0),
    // Mail the attorney still owes a reply to. 'approved' is excluded: the
    // draft is in Gmail and the thread is his to send, not the queue's.
    section('emailTriageNeedsReplyCount', () => count(admin.from('email_triage_threads')
      .select('id', { count: 'exact', head: true })
      .in('status', ['needs_reply', 'drafting', 'drafted', 'failed'])), 0),
    section('overdueInvoiceCount', fetchOverdueInvoiceCount, 0),
  ])
  return { intakeReviewCount, draftingNeedsDesignCount, agingRedCount: aging.red, agingAmberCount: aging.amber,
    tasksOverdueCount, inboxNeedsReplyCount, emailTriageNeedsReplyCount, overdueInvoiceCount, errors }
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
    .select('id, subtotal_cents, kind')
    .in('status', ['issued', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', firmTodayKey())
  if (error) throw new Error('Overdue invoices are unavailable')
  const invoices = data ?? []
  const balances = await loadInvoiceBalances(admin, invoices)
  return invoices.filter(invoice => (balances.get(invoice.id) ?? 0) > 0).length
}
