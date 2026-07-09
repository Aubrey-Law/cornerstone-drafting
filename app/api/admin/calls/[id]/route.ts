import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
