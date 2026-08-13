import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { MatterDeletionError, deleteMatter } from '@/lib/matters/deleteMatter'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()
  const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Permanent deletion requires an administrator' }, { status: 403 })
  }

  let body: { ids?: unknown; confirm?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No matter ids provided' }, { status: 400 })
  }

  // One acknowledgement covers the selection: the list cannot say which of the
  // selected matters are hired without a round trip, so a caller that has not
  // confirmed simply gets those back as failures and can retry with confirm.
  const confirmProtected = body.confirm === true
  const reason = typeof body.reason === 'string' ? body.reason : null

  const results: { id: string; ok: boolean; error?: string; requiresConfirmation?: boolean }[] = []

  for (const id of ids) {
    try {
      await deleteMatter(admin, id, {
        confirmProtected,
        actorId: userId,
        actorEmail: user?.email ?? null,
        reason,
      })
      results.push({ id, ok: true })
    } catch (e) {
      results.push({
        id,
        ok: false,
        error: e instanceof Error ? e.message : 'Could not delete matter',
        requiresConfirmation: e instanceof MatterDeletionError && e.code === 'confirmation_required',
      })
    }
  }

  const deleted = results.filter(result => result.ok).length
  const failed = results.filter(result => !result.ok)

  return NextResponse.json({
    ok: failed.length === 0,
    deleted,
    total: ids.length,
    requiresConfirmation: failed.some(result => result.requiresConfirmation),
    results,
  })
}
