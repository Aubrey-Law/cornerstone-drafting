import { NextResponse } from 'next/server'
import { requireAdmin, requirePermanentDeletionRole } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { ContactDeletionError } from '@/lib/contacts/deleteContact'
import { deletePerson } from '@/lib/people/deletePerson'
import { MatterDeletionError } from '@/lib/matters/deleteMatter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/admin/people/[id] — remove someone from the firm directory for
 * good.
 *
 * `[id]` is the People list's own row id — `intake:<uuid>` for a lead or
 * client, `contact:<uuid>` for everyone else — so the caller deletes the row it
 * is looking at without having to know which table it came from. A person whose
 * engagements carry client work comes back as 409 `requiresConfirmation` with
 * the reasons named; the caller re-sends `{ confirm: true }`.
 *
 * The directory has no archive, so this is its only exit. Deleting a person is
 * irreversible and takes their matters with them, which is why it is held to
 * the administrator role the same way deleting a matter is.
 */
export async function DELETE(req: Request, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const forbidden = await requirePermanentDeletionRole(userId)
  if (forbidden) return forbidden

  const { id: rawId } = await params
  const directoryId = decodeURIComponent(rawId)
  const body = (await req.json().catch(() => null)) as
    | { confirm?: boolean; reason?: string | null }
    | null

  try {
    const result = await deletePerson(getAdminClient(), directoryId, {
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
    if (e instanceof ContactDeletionError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === 'not_found' ? 404 : 409 },
      )
    }
    const message = e instanceof Error ? e.message : 'Could not delete this person'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
