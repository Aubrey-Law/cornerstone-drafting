import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { firmTodayKey } from '@/lib/firmDate'

const REMINDER_COPY = {
  friendly: 'A quick reminder that this invoice is now due. If payment is already on its way, thank you and please disregard this note.',
  firm: 'This invoice remains past due. Please arrange payment or let us know when we should expect it.',
  final: 'This invoice remains unpaid and is significantly past due. Please arrange payment or contact the firm to discuss the account.',
} as const

function mondayKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

/** Drafts at most one reminder per overdue invoice per firm week. Never sends. */
export async function prepareInvoiceReminderDrafts() {
  const admin = getAdminClient()
  const today = firmTodayKey()
  const cadenceWeek = mondayKey(today)
  const { data, error } = await admin
    .from('invoices')
    .select('id, number, subtotal_cents, due_date, bill_to_email, kind')
    // A carrier invoice is never chased by email; its claims are followed up
    // on the carrier's portal.
    .eq('payer', 'client')
    .in('status', ['issued', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', today)
  if (error) {
    // Feature may be disabled and its migration intentionally unapplied.
    return { drafted: 0, unavailable: true }
  }
  const balances = await loadInvoiceBalances(admin, data ?? [])
  let drafted = 0
  for (const invoice of data ?? []) {
    if (!invoice.bill_to_email || !invoice.due_date) continue
    if ((balances.get(invoice.id) ?? 0) <= 0) continue
    const days = Math.max(1, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${invoice.due_date}T12:00:00Z`)) / 86_400_000))
    const level = days >= 28 ? 'final' : days >= 14 ? 'firm' : 'friendly'
    const { error: insertError } = await admin.from('invoice_reminders').insert({
      invoice_id: invoice.id,
      cadence_week: cadenceWeek,
      escalation_level: level,
      recipient_email: invoice.bill_to_email,
      subject: `Reminder: invoice ${invoice.number ?? ''}`.trim(),
      body: REMINDER_COPY[level],
    })
    if (!insertError) drafted += 1
    else if (insertError.code !== '23505') throw new Error('Reminder draft could not be saved')
  }
  return { drafted, unavailable: false }
}

