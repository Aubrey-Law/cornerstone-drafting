import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { MatterDeletionError, deleteMatter } from '@/lib/matters/deleteMatter'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/admin/matters/[id] — destroy a matter outright.
 *
 * The third exit alongside closing and archiving, and the only irreversible one.
 * A hired matter, or one with a signed engagement, comes back as 409
 * `requiresConfirmation` with the reasons named; the caller re-sends
 * `{ confirm: true }` to go through with it.
 */
export async function DELETE(req: Request, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params
  const body = (await req.json().catch(() => null)) as
    | { confirm?: boolean; reason?: string | null }
    | null

  try {
    const admin = getAdminClient()
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Permanent deletion requires an administrator' }, { status: 403 })
    }
    const result = await deleteMatter(admin, rawId, {
      confirmProtected: body?.confirm === true,
      actorId: userId,
      actorEmail: user?.email ?? null,
      reason: typeof body?.reason === 'string' ? body.reason : null,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof MatterDeletionError) {
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          protections: e.protections,
          requiresConfirmation: e.code === 'confirmation_required',
        },
        { status: e.code === 'not_found' ? 404 : 409 },
      )
    }
    const message = e instanceof Error ? e.message : 'Could not delete matter'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
