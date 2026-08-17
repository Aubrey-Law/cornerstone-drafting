import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, sendInvoiceSchema } from '@/lib/billing/invoices'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

/** Sends or re-sends an already-issued invoice. Re-renders so the balance is current. */
export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const parsed = sendInvoiceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const invoice = await reloadInvoice(parsedId.data)
  if (invoice.status === 'draft') {
    return NextResponse.json({ error: 'Issue the invoice before sending it' }, { status: 409 })
  }
  if (invoice.status === 'void') {
    return NextResponse.json({ error: 'A void invoice cannot be sent' }, { status: 409 })
  }

  const rendered = await renderAndAttachInvoice(invoice, auth.userId)
  const result = await emailInvoice({
    invoice,
    rendered,
    to: parsed.data.to,
    cc: parsed.data.cc,
    message: parsed.data.message ?? null,
    actorId: auth.userId,
  })

  if (result.status === 'skipped') {
    return NextResponse.json({ error: result.reason ?? 'Sending is switched off' }, { status: 409 })
  }

  const { error } = await getAdminClient().rpc('mark_invoice_sent', {
    p_invoice_id: parsedId.data,
    p_channel: 'email',
    p_recipient: parsed.data.to,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({ invoice: await reloadInvoice(parsedId.data), sent: true })
}
