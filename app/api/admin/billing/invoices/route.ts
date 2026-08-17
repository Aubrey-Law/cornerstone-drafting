import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { createInvoiceDraftSchema, invoiceStatuses, type InvoiceStatus } from '@/lib/billing/invoices'
import { fetchInvoices } from '@/lib/queries/invoices'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const url = new URL(req.url)
  const matterId = url.searchParams.get('matterId') ?? undefined
  const statusParam = url.searchParams.get('status')
  const status = (invoiceStatuses as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as InvoiceStatus)
    : undefined

  try {
    return NextResponse.json({ invoices: await fetchInvoices({ matterId, status }) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load invoices' },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = createInvoiceDraftSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid invoice' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('create_invoice_draft', {
    p_matter_id: parsed.data.matterId,
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

  return NextResponse.json({ invoice: data }, { status: 201 })
}
