'use server'

import { isStaffRole } from '@/lib/auth/gate'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { runMatterAudit } from '@/lib/fieldAudit/run'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

// `maxDuration` lives on page.tsx, not here: a "use server" file may only
// export async functions — see the comment there for why the segment config
// has to sit on the page instead.

export interface RunAuditState {
  ok: boolean | null
  message: string | null
  runId: string | null
  findingCount: number | null
  tasksCreated: number | null
}

// Not exported: a "use server" file may only export async functions, so the
// workspace component keeps its own copy of the empty state to seed
// `useActionState` with (see PromptsWorkspace.tsx). This one is only ever
// used to fill in the fields a failure response doesn't set.
const emptyState: RunAuditState = {
  ok: null,
  message: null,
  runId: null,
  findingCount: null,
  tasksCreated: null,
}

/**
 * Runs one field-audit prompt against one matter's design sheet.
 *
 * Checks the session itself: a server action is a public endpoint, so the
 * page it was rendered from having been gated proves nothing about the
 * request — the same reasoning as `recordDisposition` in
 * `app/review/[runId]/actions.ts`.
 */
export async function runAudit(_previous: RunAuditState, form: FormData): Promise<RunAuditState> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) {
    return { ...emptyState, ok: false, message: 'You are not signed in as staff.' }
  }

  const slug = String(form.get('slug') ?? '').trim()
  const matterId = String(form.get('matterId') ?? '').trim()
  if (!slug) return { ...emptyState, ok: false, message: 'Choose a prompt to run.' }
  if (!matterId) return { ...emptyState, ok: false, message: 'Choose a matter to run it against.' }

  let callModel
  try {
    callModel = anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) {
      // Matches how app/api/staff/review/route.ts treats the same error: the
      // app is fine, this feature is not configured.
      return { ...emptyState, ok: false, message: error.message }
    }
    throw error
  }

  const result = await runMatterAudit(getAdminClient(), {
    slug,
    matterId,
    userId: user.id,
    callModel,
  })
  if (!result.ok) return { ...emptyState, ok: false, message: result.message }

  return {
    ok: true,
    message: null,
    runId: result.runId,
    findingCount: result.findingCount,
    tasksCreated: result.tasksCreated,
  }
}
