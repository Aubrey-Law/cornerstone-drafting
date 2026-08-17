import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, updateInvoiceDraftSchema } from '@/lib/billing/invoices'
import { fetchInvoice } from '@/lib/queries/invoices'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

async function invoiceId(context: Context) {
  return invoiceIdSchema.safeParse((await context.params).id)
}

export async function GET(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const parsedId = await invoiceId(context)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const invoice = await fetchInvoice(parsedId.data)
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  return NextResponse.json({ invoice })
}

export async function PATCH(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = await invoiceId(context)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = updateInvoiceDraftSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid invoice' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('update_invoice_draft', {
    p_invoice_id: parsedId.data,
    p_item_ids: parsed.data.itemIds,
    p_issue_date: parsed.data.issueDate,
    p_due_date: parsed.data.dueDate,
    p_notes: parsed.data.notes ?? null,
    p_terms: parsed.data.terms ?? null,
    p_bill_to_name: parsed.data.billToName ?? null,
    p_bill_to_email: parsed.data.billToEmail ?? null,
    p_payment_link: parsed.data.paymentLink ?? null,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({ invoice: data })
}

export async function DELETE(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = await invoiceId(context)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const { error } = await getAdminClient().rpc('discard_invoice_draft', {
    p_invoice_id: parsedId.data,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({ ok: true })
}
