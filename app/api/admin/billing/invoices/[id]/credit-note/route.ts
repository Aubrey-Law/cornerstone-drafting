import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }
const schema = z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(3).max(500) })

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const body = schema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'A positive amount and reason are required' }, { status: 400 })
  const { data, error } = await getAdminClient().rpc('issue_invoice_credit_note', {
    p_invoice_id: (await params).id,
    p_amount_cents: body.data.amountCents,
    p_reason: body.data.reason,
    p_actor_id: auth.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ creditNote: data }, { status: 201 })
}
