'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { retryFailedSteps } from '@/lib/runs/retry'
import { saveDisposition, type Disposition } from '@/lib/review/persist'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { linkReviewUpload } from '@/lib/review/uploads'

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

export interface RetryState {
  message: string | null
}

/**
 * Re-queues the rules a review lost, and only them.
 *
 * Checks the session itself, the same as `recordDisposition` above — a
 * server action is a public endpoint regardless of which page rendered the
 * button that calls it. `retryFailedSteps` itself no longer calls the
 * model — a tick does, once it claims the requeued run — so this only fails
 * fast, the way `app/prompts/actions.ts`'s `runAudit` does, rather than
 * queueing a retry the tick could never work.
 */
export async function retryRun(_previous: RetryState, form: FormData): Promise<RetryState> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) return { message: 'You are not signed in as staff.' }

  const runId = String(form.get('runId') ?? '')
  if (!runId) return { message: 'That form was missing its run.' }

  try {
    anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) return { message: error.message }
    throw error
  }

  const result = await retryFailedSteps(getAdminClient(), runId)
  if (!result.ok) return { message: result.message }

  revalidatePath(`/review/${runId}`)
  return { message: null }
}

export interface LinkUploadState {
  message: string | null
  ok: boolean | null
}

/**
 * Links the upload a review was of to a matter, or unlinks it (empty
 * `matterId`). Checks the session itself, like the actions above.
 */
export async function linkUpload(_previous: LinkUploadState, form: FormData): Promise<LinkUploadState> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) return { ok: false, message: 'You are not signed in as staff.' }

  const reviewUploadId = String(form.get('reviewUploadId') ?? '').trim()
  const matterId = String(form.get('matterId') ?? '').trim() || null
  const runId = String(form.get('runId') ?? '').trim()
  if (!reviewUploadId) return { ok: false, message: 'That form was missing its upload.' }

  const result = await linkReviewUpload(getAdminClient(), { reviewUploadId, matterId, userId: user.id })
  if (!result.ok) return { ok: false, message: result.message }

  revalidatePath(`/review/${runId}`)
  revalidatePath('/review')
  return { ok: true, message: matterId ? 'Linked.' : 'Unlinked.' }
}
