import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { dismissed?: unknown } | null
  if (typeof body?.dismissed !== 'boolean') {
    return NextResponse.json({ error: 'dismissed must be a boolean' }, { status: 400 })
  }

  const { id } = await params
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('calls')
    .update({
      triage_dismissed_at: body.dismissed ? new Date().toISOString() : null,
      triage_dismissed_by: body.dismissed ? userId : null,
    })
    .eq('id', id)
    .is('matter_id', null)
    .is('lead_id', null)
    .is('contact_id', null)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Unlinked call not found' }, { status: 404 })
  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const admin = getAdminClient()
  const { error } = await admin.from('calls').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}
