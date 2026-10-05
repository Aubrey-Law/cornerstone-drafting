import 'server-only'
import type { InvoiceReminderLevel } from '@/lib/billing/sendInvoiceReminder'

/**
 * Where a freshly drafted invoice reminder meets the delegation dial.
 *
 * At Propose the draft waits as it always has. At Observe the run records
 * what it would have sent. At Act and report it sends through the shared
 * registry action, with the invoice attached, and the send lands in the
 * digest and on Today.
 */

export const INVOICE_REMINDER_ACTION_KEY = 'billing.reminder.send'

/**
 * A final notice is the firm telling a client the account is in trouble.
 * That one is always the attorney's to send, whatever the dial says.
 */
export const DELEGATED_REMINDER_LEVELS: readonly InvoiceReminderLevel[] = ['friendly', 'firm']

export type ReminderDelegationOutcome = 'skipped' | 'observed' | 'sent' | 'failed'

export interface ReminderDelegationRow {
  id: string
  invoice_id: string
  escalation_level: InvoiceReminderLevel
  recipient_email: string
  invoice_number: string | null
  matter_id: string | null
}

export function reminderSummary(row: Pick<ReminderDelegationRow, 'escalation_level' | 'recipient_email' | 'invoice_number'>): string {
  const invoice = row.invoice_number ? `invoice ${row.invoice_number}` : 'an invoice'
  return `Send the ${row.escalation_level} reminder for ${invoice} to ${row.recipient_email}`
}

export async function delegateInvoiceReminder(args: {
  row: ReminderDelegationRow
  /** The staff user the send runs as; null means the dial is not consulted. */
  actorId: string | null
}): Promise<ReminderDelegationOutcome> {
  const { row, actorId } = args
  if (!actorId) return 'skipped'
  if (!DELEGATED_REMINDER_LEVELS.includes(row.escalation_level)) return 'skipped'

  const { resolveActionAutonomy } = await import('@/lib/actions/delegation')
  const autonomy = await resolveActionAutonomy(INVOICE_REMINDER_ACTION_KEY, 'external_write')
  if (autonomy === 'propose') return 'skipped'

  try {
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: INVOICE_REMINDER_ACTION_KEY,
      displaySummary: reminderSummary(row),
      referencePayload: { reminderId: row.id },
      recordType: row.matter_id ? 'matter' : 'firm',
      recordId: row.matter_id ?? undefined,
      source: 'automation',
      // One decision per draft; the draft itself is one per invoice per week.
      idempotencyKey: `invoice-reminder:${row.id}`,
      applyAutonomy: true,
    }, { id: actorId })
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution?.status === 'succeeded') return 'sent'
    return created.duplicate ? 'skipped' : 'failed'
  } catch (error) {
    // The send module already put the row back to draft; it stays in the
    // queue for a person. Nothing else to clean up.
    console.error('invoice reminder delegation failed', {
      reminderId: row.id,
      cause: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}
