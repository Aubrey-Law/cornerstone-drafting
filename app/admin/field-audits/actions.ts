'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { runMatterAudit } from '@/lib/fieldAudit/run'
import { reviewClient } from '@/lib/review/staff'

export interface RunAuditState {
  ok: boolean | null
  message: string | null
  runId: string | null
}

// Not exported: a "use server" file may only export async functions, so the
// workspace keeps its own copy of the empty state to seed `useActionState`.
const emptyState: RunAuditState = { ok: null, message: null, runId: null }

/**
 * Queues one field-audit prompt against one matter's design sheet. The run
 * queue's cron (`app/api/cron/run-queue`) works it within the minute and
 * opens tasks from what it finds.
 *
 * Checks the caller itself: a server action is a public endpoint, so the page
 * it was rendered from having been gated proves nothing about the request.
 * Ported from the workbench's `app/prompts/actions.ts`.
 */
export async function runAudit(_previous: RunAuditState, form: FormData): Promise<RunAuditState> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { ...emptyState, ok: false, message: 'You are not signed in as staff.' }
  }

  const slug = String(form.get('slug') ?? '').trim()
  const matterId = String(form.get('matterId') ?? '').trim()
  if (!slug) return { ...emptyState, ok: false, message: 'Choose a prompt to run.' }
  if (!matterId) return { ...emptyState, ok: false, message: 'Choose a matter to run it against.' }

  // Refused before queueing a run the queue could never work.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      ...emptyState,
      ok: false,
      message: 'ANTHROPIC_API_KEY is not set, so an audit cannot be run. Set it on this app’s environment.',
    }
  }

  const result = await runMatterAudit(reviewClient(), { slug, matterId, userId })
  if (!result.ok) return { ...emptyState, ok: false, message: result.message }

  // The matter's Reviews tab reloads itself; the firm-wide page is server-rendered.
  revalidatePath('/admin/field-audits')
  return { ok: true, message: null, runId: result.runId }
}
