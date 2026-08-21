import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const admin = getAdminClient()
  const reminderId = (await params).id
  const { data, error } = await admin.rpc('approve_invoice_reminder', {
    p_reminder_id: reminderId,
    p_actor_id: auth.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  const reminder = data as { invoice_id: string; recipient_email: string; body: string }
  try {
    const invoice = await reloadInvoice(reminder.invoice_id)
    const currentRecipient = invoice.billToEmail ?? invoice.clientEmail
    if (!currentRecipient || currentRecipient.toLowerCase() !== reminder.recipient_email.toLowerCase()) {
      throw new Error('The client email changed; regenerate this reminder before sending')
    }
    const rendered = await renderAndAttachInvoice(invoice, auth.userId!)
    const sent = await emailInvoice({
      invoice, rendered, to: currentRecipient, message: reminder.body,
      actorId: auth.userId!, reminder: true,
    })
    if (sent.status !== 'sent') throw new Error(sent.reason ?? 'Reminder sending is disabled')
    await Promise.all([
      admin.from('invoice_reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminderId),
      admin.rpc('mark_invoice_reminder_sent', { p_invoice_id: invoice.id, p_actor_id: auth.userId }),
    ])
    return NextResponse.json({ sent: true })
  } catch (sendError) {
    await admin.from('invoice_reminders').update({ status: 'draft', approved_by: null, approved_at: null }).eq('id', reminderId)
    return NextResponse.json({ error: sendError instanceof Error ? sendError.message : 'Could not send reminder' }, { status: 409 })
  }
}
