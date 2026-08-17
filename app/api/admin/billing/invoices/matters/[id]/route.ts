import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { invoiceIdSchema } from '@/lib/billing/invoices'
import { fetchInvoiceableCharges, fetchInvoices } from '@/lib/queries/invoices'

type Context = { params: Promise<{ id: string }> }

/** What the composer needs for one matter: its invoices and its open charges. */
export async function GET(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const [invoices, charges] = await Promise.all([
      fetchInvoices({ matterId: parsedId.data }),
      fetchInvoiceableCharges(parsedId.data),
    ])
    return NextResponse.json({ invoices, charges })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load matter invoices' },
      { status: 500 },
    )
  }
}
