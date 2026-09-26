'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { saveDisposition, type Disposition } from '@/lib/review/persist'
import { linkReviewUpload } from '@/lib/review/uploads'
import { queueStoredUploadReview } from '@/lib/review/uploadReview'
import { retryFailedSteps } from '@/lib/runs/retry'

/**
 * The saved-review page's writes. Each checks the caller itself: a server
 * action is a public endpoint, so the page it was rendered from having been
 * gated proves nothing about the request.
 *
 * Ported from the workbench's `app/review/[runId]/actions.ts`. Queued work —
 * a retry, another review of an upload — is picked up by the workbench's tick,
 * which reads the same tables (see `lib/runs/enqueue.ts`).
 */

const DISPOSITIONS: Disposition[] = ['open', 'accepted', 'rejected', 'deferred']

function client(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

export async function recordDisposition(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const findingId = String(form.get('findingId') ?? '')
  const disposition = String(form.get('disposition') ?? '')
  const runId = String(form.get('runId') ?? '')
  const note = String(form.get('note') ?? '').trim() || null

  if (!findingId) return { message: 'That form was missing its finding.' }
  if (!DISPOSITIONS.includes(disposition as Disposition)) return { message: 'Unknown disposition.' }

  const result = await saveDisposition(client(), {
    findingId,
    disposition: disposition as Disposition,
    note,
    userId,
  })
  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/review/${runId}`)
  return { message: null }
}

export interface RetryState {
  message: string | null
}

/** Re-queues the rules a review lost, and only them. */
export async function retryRun(_previous: RetryState, form: FormData): Promise<RetryState> {
  try {
    await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const runId = String(form.get('runId') ?? '')
  if (!runId) return { message: 'That form was missing its run.' }

  const result = await retryFailedSteps(client(), runId)
  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/review/${runId}`)
  return { message: null }
}

export interface LinkUploadState {
  message: string | null
  ok: boolean | null
}

/** Links the upload a review was of to a matter, or unlinks it (empty `matterId`). */
export async function linkUpload(_previous: LinkUploadState, form: FormData): Promise<LinkUploadState> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { ok: false, message: 'You are not signed in as staff.' }
  }

  const reviewUploadId = String(form.get('reviewUploadId') ?? '').trim()
  const matterId = String(form.get('matterId') ?? '').trim() || null
  const runId = String(form.get('runId') ?? '').trim()
  if (!reviewUploadId) return { ok: false, message: 'That form was missing its upload.' }

  const result = await linkReviewUpload(client(), { reviewUploadId, matterId, userId })
  if (!result.ok) return { ok: false, message: result.message }

  revalidatePath(`/admin/review/${runId}`)
  revalidatePath('/admin/review')
  return { ok: true, message: matterId ? 'Linked.' : 'Unlinked.' }
}

export type ReviewAgainResult = { ok: true; runId: string } | { ok: false; message: string }

/**
 * Queues another review of an upload from its stored text, with the chosen
 * published playbook. A linked matter's design sheet decides which
 * conditional rules apply.
 */
export async function reviewUploadAgain(reviewUploadId: string, playbookSlug: string): Promise<ReviewAgainResult> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { ok: false, message: 'You are not signed in as staff.' }
  }
  if (!reviewUploadId || !playbookSlug) return { ok: false, message: 'Choose a playbook to run.' }

  const admin = client()
  const prompt = await loadPublishedPrompt(admin, playbookSlug)
  if (!prompt || prompt.body.kind !== 'review') {
    return { ok: false, message: `No published review playbook named "${playbookSlug}".` }
  }

  try {
    const queued = await queueStoredUploadReview(admin, {
      reviewUploadId,
      promptVersionId: prompt.versionId,
      ruleNumbers: prompt.body.rules.map(rule => rule.number),
      userId,
    })
    if (!queued.ok) return { ok: false, message: queued.message }
    revalidatePath('/admin/review')
    return { ok: true, runId: queued.runId }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The review could not be queued.' }
  }
}
