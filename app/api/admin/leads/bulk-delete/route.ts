import { NextResponse } from 'next/server'
import { requireAdmin, requirePermanentDeletionRole } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { archiveLead, deleteLeadPermanently } from '@/lib/leads/removeLead'
import { MatterDeletionError } from '@/lib/matters/deleteMatter'

/**
 * POST /api/admin/leads/bulk-delete — archive the selected leads, or destroy
 * them outright with `{ permanent: true }`.
 *
 * One acknowledgement covers the selection, the same way the matter bulk route
 * handles it: a lead the caller has not been told is protected comes back as a
 * failure carrying `requiresConfirmation`, and the caller retries with
 * `confirm`.
 */
export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  let body: { ids?: unknown; permanent?: unknown; confirm?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No lead ids provided' }, { status: 400 })
  }

  const permanent = body.permanent === true
  if (permanent) {
    const forbidden = await requirePermanentDeletionRole(userId)
    if (forbidden) return forbidden
  }

  const admin = getAdminClient()
  const results: { id: string; ok: boolean; error?: string; requiresConfirmation?: boolean }[] = []
  for (const id of ids) {
    try {
      if (permanent) {
        await deleteLeadPermanently(admin, id, {
          confirmProtected: body.confirm === true,
          actorId: userId,
          actorEmail: user?.email ?? null,
          reason: typeof body.reason === 'string' ? body.reason : null,
        })
      } else {
        await archiveLead(admin, id)
      }
      results.push({ id, ok: true })
    } catch (e) {
      results.push({
        id,
        ok: false,
        error: e instanceof Error ? e.message : 'Could not delete lead',
        requiresConfirmation: e instanceof MatterDeletionError && e.code === 'confirmation_required',
      })
    }
  }

  const deleted = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    deleted,
    total: ids.length,
    permanent,
    requiresConfirmation: failed.some(r => r.requiresConfirmation),
    results,
  })
}
