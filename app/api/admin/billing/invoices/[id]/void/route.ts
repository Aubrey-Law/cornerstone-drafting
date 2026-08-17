import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, voidInvoiceSchema } from '@/lib/billing/invoices'
import { reloadInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const parsed = voidInvoiceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'A void needs a reason' }, { status: 400 })
  }

  const { error } = await getAdminClient().rpc('void_invoice', {
    p_invoice_id: parsedId.data,
    p_reason: parsed.data.reason,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({ invoice: await reloadInvoice(parsedId.data) })
}
