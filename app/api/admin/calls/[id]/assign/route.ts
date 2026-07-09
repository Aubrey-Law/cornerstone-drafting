import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

const Body = z.object({
  matterId: z.string().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'matterId is required' }, { status: 400 })
  }

  const admin = getAdminClient()

  const { data: matter } = await admin
    .from('matters')
    .select('id')
    .eq('id', parsed.data.matterId)
    .maybeSingle()

  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('calls')
    .update({
      matter_id: parsed.data.matterId,
      assigned_by: userId,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}
