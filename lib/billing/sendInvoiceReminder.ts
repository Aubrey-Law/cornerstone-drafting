import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'

/**
 * Sending a drafted invoice reminder, shared by the approve route and the
 * `billing.reminder.send` registry action the delegation dial runs.
 *
 * The approve RPC is the claim: it moves exactly one `draft` row to
 * `approved` under the billing-actor check, so two sends of the same draft
 * cannot both deliver. A failure after the claim puts the row back to draft,
 * so the reminder stays in the queue with nothing lost.
 */

export type InvoiceReminderLevel = 'friendly' | 'firm' | 'final'

export interface InvoiceReminderRow {
  id: string
  invoice_id: string
  cadence_week: string
  escalation_level: InvoiceReminderLevel
  recipient_email: string
  subject: string
  body: string
  status: 'draft' | 'approved' | 'sent' | 'suppressed'
  sent_at: string | null
}

export class InvoiceReminderError extends Error {
  constructor(message: string, readonly code: 'claim' | 'send') {
    super(message)
    this.name = 'InvoiceReminderError'
  }
}

export async function fetchInvoiceReminder(admin: SupabaseClient, reminderId: string): Promise<InvoiceReminderRow | null> {
  const { data, error } = await admin.from('invoice_reminders')
    .select('id, invoice_id, cadence_week, escalation_level, recipient_email, subject, body, status, sent_at')
    .eq('id', reminderId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as InvoiceReminderRow | null) ?? null
}

export async function sendInvoiceReminder(args: {
  admin: SupabaseClient
  reminderId: string
  actorId: string
}): Promise<{ sent: true; reminderId: string; invoiceId: string; invoiceNumber: string | null; to: string }> {
  const { admin, reminderId, actorId } = args
  const { data, error } = await admin.rpc('approve_invoice_reminder', {
    p_reminder_id: reminderId,
    p_actor_id: actorId,
  })
  if (error) throw new InvoiceReminderError(error.message, 'claim')
  const reminder = data as { invoice_id: string; recipient_email: string; body: string }
  try {
    const invoice = await reloadInvoice(reminder.invoice_id)
    // The draft named a recipient when it was written. If the client's email
    // has changed since, this draft is for the wrong address and is not sent.
    const currentRecipient = invoice.billToEmail ?? invoice.clientEmail
    if (!currentRecipient || currentRecipient.toLowerCase() !== reminder.recipient_email.toLowerCase()) {
      throw new Error('The client email changed; regenerate this reminder before sending')
    }
    const rendered = await renderAndAttachInvoice(invoice, actorId)
    const sent = await emailInvoice({
      invoice, rendered, to: currentRecipient, message: reminder.body,
      actorId, reminder: true,
    })
    if (sent.status !== 'sent') throw new Error(sent.reason ?? 'Reminder sending is disabled')
    await Promise.all([
      admin.from('invoice_reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminderId),
      admin.rpc('mark_invoice_reminder_sent', { p_invoice_id: invoice.id, p_actor_id: actorId }),
    ])
    return { sent: true, reminderId, invoiceId: invoice.id, invoiceNumber: invoice.number, to: currentRecipient }
  } catch (sendError) {
    await admin.from('invoice_reminders').update({ status: 'draft', approved_by: null, approved_at: null }).eq('id', reminderId)
    throw new InvoiceReminderError(sendError instanceof Error ? sendError.message : 'Could not send reminder', 'send')
  }
}
