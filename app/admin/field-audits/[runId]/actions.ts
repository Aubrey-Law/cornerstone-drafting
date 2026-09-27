'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { saveDisposition, type Disposition } from '@/lib/review/persist'
import { reviewClient } from '@/lib/review/staff'
import { retryFailedSteps } from '@/lib/runs/retry'

/**
 * A field-audit run's writes. Each checks the caller itself: a server action
 * is a public endpoint whether or not the page that rendered its button was
 * gated.
 */

const DISPOSITIONS: Disposition[] = ['open', 'accepted', 'rejected', 'deferred']

export interface RetryState {
  message: string | null
}

/** Re-queues the checks a field audit lost, and only them. */
export async function retryRun(_previous: RetryState, form: FormData): Promise<RetryState> {
  try {
    await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const runId = String(form.get('runId') ?? '')
  if (!runId) return { message: 'That form was missing its run.' }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { message: 'ANTHROPIC_API_KEY is not set, so the checks cannot be run again.' }
  }

  const result = await retryFailedSteps(reviewClient(), runId)
  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/field-audits/${runId}`)
  return { message: null }
}

/**
 * Records a decision on a finding: accepted, rejected, deferred, or reopened.
 *
 * The workbench's list of unresolved blockers told the attorney to
 * "disposition it on the run page", and its run page had no way to. This is
 * that way: the same `workflow_findings.disposition` a review's findings use,
 * and any decision clears a blocker from the list.
 */
export async function recordFieldAuditDisposition(
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
  if (!findingId) return { message: 'That form was missing its finding.' }
  if (!DISPOSITIONS.includes(disposition as Disposition)) return { message: 'Unknown disposition.' }

  const result = await saveDisposition(reviewClient(), {
    findingId,
    disposition: disposition as Disposition,
    note: null,
    userId,
  })
  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/field-audits/${runId}`)
  revalidatePath('/admin/field-audits')
  return { message: null }
}
