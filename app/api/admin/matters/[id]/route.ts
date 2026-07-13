import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { deleteMatter } from '@/lib/matters/deleteMatter'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: Request, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params

  try {
    const admin = getAdminClient()
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Permanent deletion requires an administrator' }, { status: 403 })
    }
    const result = await deleteMatter(admin, rawId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not delete matter'
    const status = message === 'Matter not found' ? 404 : message.includes('cannot be permanently deleted') || message.includes('must be closed or archived') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
