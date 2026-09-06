'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { retryFailedSteps } from '@/lib/runs/retry'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export interface RetryState {
  message: string | null
}

/**
 * Re-queues the checks a field audit lost, and only them.
 *
 * Follows the shape of `app/review/[runId]/actions.ts`'s `retryRun`: checks
 * the session itself, because a server action is a public endpoint whether
 * or not the page that rendered its button was gated. `retryFailedSteps`
 * itself no longer calls the model — a tick does, once it claims the
 * requeued run — so this only fails fast, the way `app/prompts/actions.ts`'s
 * `runAudit` does, rather than queueing a retry the tick could never work.
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

  revalidatePath(`/prompts/${runId}`)
  return { message: null }
}
