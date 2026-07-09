import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { deleteMatter } from '@/lib/matters/deleteMatter'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params

  try {
    const admin = getAdminClient()
    const matterId = await resolveMatterId(rawId, admin)
    const result = await deleteMatter(admin, matterId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not delete matter'
    const status = message === 'Matter not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
