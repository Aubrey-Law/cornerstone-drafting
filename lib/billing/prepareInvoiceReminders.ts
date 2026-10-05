import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { firmTodayKey } from '@/lib/firmDate'
import { delegateInvoiceReminder, type ReminderDelegationRow } from '@/lib/billing/delegateReminders'

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

export interface PrepareInvoiceRemindersResult {
  drafted: number
  unavailable: boolean
  /** Drafts the delegation dial sent on its own this run. */
  sent: number
  /** Drafts the dial recorded as "would have sent" without sending. */
  observed: number
}

/**
 * Drafts at most one reminder per overdue invoice per firm week.
 *
 * Drafting itself never sends. Each new draft is then offered to the
 * delegation dial when the caller names a staff user to act as; with no
 * actor, or at Propose, the draft waits exactly as before.
 */
export async function prepareInvoiceReminderDrafts(
  options: { actorId?: string | null } = {},
): Promise<PrepareInvoiceRemindersResult> {
  const admin = getAdminClient()
  const today = firmTodayKey()
  const cadenceWeek = mondayKey(today)
  const { data, error } = await admin
    .from('invoices')
    .select('id, number, subtotal_cents, due_date, bill_to_email, kind, matter_id')
    // A carrier invoice is never chased by email; its claims are followed up
    // on the carrier's portal.
    .eq('payer', 'client')
    .in('status', ['issued', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', today)
  if (error) {
    // Feature may be disabled and its migration intentionally unapplied.
    return { drafted: 0, unavailable: true, sent: 0, observed: 0 }
  }
  const balances = await loadInvoiceBalances(admin, data ?? [])
  let drafted = 0
  const fresh: ReminderDelegationRow[] = []
  for (const invoice of data ?? []) {
    if (!invoice.bill_to_email || !invoice.due_date) continue
    if ((balances.get(invoice.id) ?? 0) <= 0) continue
    const days = Math.max(1, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${invoice.due_date}T12:00:00Z`)) / 86_400_000))
    const level = days >= 28 ? 'final' : days >= 14 ? 'firm' : 'friendly'
    const { data: inserted, error: insertError } = await admin.from('invoice_reminders').insert({
      invoice_id: invoice.id,
      cadence_week: cadenceWeek,
      escalation_level: level,
      recipient_email: invoice.bill_to_email,
      subject: `Reminder: invoice ${invoice.number ?? ''}`.trim(),
      body: REMINDER_COPY[level],
    }).select('id').maybeSingle()
    if (insertError) {
      // A draft already exists for this invoice this week: it was offered to
      // the dial when it was written, so it is not offered again.
      if (insertError.code !== '23505') throw new Error('Reminder draft could not be saved')
      continue
    }
    drafted += 1
    if (inserted?.id) {
      fresh.push({
        id: inserted.id,
        invoice_id: invoice.id,
        escalation_level: level,
        recipient_email: invoice.bill_to_email,
        invoice_number: invoice.number ?? null,
        matter_id: invoice.matter_id ?? null,
      })
    }
  }

  let sent = 0
  let observed = 0
  if (options.actorId) {
    for (const row of fresh) {
      const outcome = await delegateInvoiceReminder({ row, actorId: options.actorId })
      if (outcome === 'sent') sent += 1
      else if (outcome === 'observed') observed += 1
    }
  }
  return { drafted, unavailable: false, sent, observed }
}

