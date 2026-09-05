'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { saveDisposition, type Disposition } from '@/lib/review/persist'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const DISPOSITIONS: Disposition[] = ['open', 'accepted', 'rejected', 'deferred']

/**
 * Records what the attorney decided about one finding.
 *
 * Checks the session itself: a server action is a public endpoint, so the page
 * it was rendered from having been gated proves nothing about the request.
 */
export async function recordDisposition(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) return { message: 'You are not signed in as staff.' }

  const findingId = String(form.get('findingId') ?? '')
  const disposition = String(form.get('disposition') ?? '')
  const runId = String(form.get('runId') ?? '')
  const note = String(form.get('note') ?? '').trim() || null

  if (!findingId) return { message: 'That form was missing its finding.' }
  if (!DISPOSITIONS.includes(disposition as Disposition)) return { message: 'Unknown disposition.' }

  const result = await saveDisposition(getAdminClient(), {
    findingId,
    disposition: disposition as Disposition,
    note,
    userId: user.id,
  })
  if (!result.ok) return { message: result.message }

  revalidatePath(`/review/${runId}`)
  return { message: null }
}
