import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }
const schema = z.object({ reason: z.string().trim().min(10).max(2000) })

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Explain the financial close-out exception' }, { status: 400 })
  const admin = getAdminClient()
  const matterId = await resolveMatterId((await params).id, admin).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
  if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  const { data, error } = await admin.rpc('document_matter_financial_exception', {
    p_matter_id: matterId,
    p_reason: parsed.data.reason,
    p_actor_id: auth.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ exception: data }, { status: 201 })
}
