import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, invoiceReminderSchema } from '@/lib/billing/invoices'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

/**
 * Three escalations of the same message. Replaces the blank `mailto:` the
 * billing rail used to open — the client now receives the amount, the due date
 * and the invoice itself.
 */
const REMINDER_COPY: Record<'friendly' | 'firm' | 'final', string> = {
  friendly:
    'A quick reminder that the invoice below is now due. If you have already sent payment, thank you — please disregard this note.',
  firm:
    'The invoice below is past due. We would appreciate payment at your earliest convenience, or a note letting us know when we can expect it.',
  final:
    'The invoice below remains unpaid and is now significantly past due. Please arrange payment, or contact us so we can discuss the account.',
}

export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const parsed = invoiceReminderSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const invoice = await reloadInvoice(parsedId.data)
  const to = invoice.billToEmail ?? invoice.clientEmail
  if (!to) {
    return NextResponse.json(
      { error: 'There is no email address on file for this client' },
      { status: 409 },
    )
  }

  const rendered = await renderAndAttachInvoice(invoice, auth.userId)
  const result = await emailInvoice({
    invoice,
    rendered,
    to,
    message: parsed.data.message ?? REMINDER_COPY[parsed.data.tone],
    actorId: auth.userId,
    reminder: true,
  })

  if (result.status === 'skipped') {
    return NextResponse.json({ error: result.reason ?? 'Sending is switched off' }, { status: 409 })
  }

  const { error } = await getAdminClient().rpc('mark_invoice_reminder_sent', {
    p_invoice_id: parsedId.data,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({ invoice: await reloadInvoice(parsedId.data), sent: true })
}
