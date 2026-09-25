'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { publishReviewPlaybook, type DraftRule, type PublishResult } from '@/lib/playbooks/publish'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const RISKS: DraftRule['risk'][] = ['blocker', 'high', 'medium', 'low']

export interface PublishPlaybookInput {
  slug: string
  title: string
  changeSummary: string | null
  rules: DraftRule[]
}

/**
 * Publishes the rules an attorney approved in the builder as a new version.
 *
 * Checks the session itself: a server action is a public endpoint, so the page
 * it was rendered from having been gated proves nothing about the request —
 * the same reasoning as `recordDisposition` in `app/review/[runId]/actions.ts`.
 * The argument is re-read field by field for the same reason; its type is a
 * promise the browser made, not one it has to keep.
 */
export async function publishPlaybook(input: PublishPlaybookInput): Promise<PublishResult> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) return { ok: false, message: 'You are not signed in as staff.' }

  const rawRules: unknown[] = Array.isArray(input?.rules) ? input.rules : []
  const rules: DraftRule[] = []
  for (const raw of rawRules) {
    const rule = (raw ?? {}) as Record<string, unknown>
    const statement = typeof rule.statement === 'string' ? rule.statement : ''
    const risk = rule.risk as DraftRule['risk']
    if (!statement.trim() || !RISKS.includes(risk)) {
      return { ok: false, message: `Rule ${rules.length + 1} needs a statement and a risk level.` }
    }
    rules.push({
      statement,
      risk,
      preferredLanguage: typeof rule.preferredLanguage === 'string' ? rule.preferredLanguage : null,
    })
  }

  const result = await publishReviewPlaybook(getAdminClient(), {
    slug: String(input?.slug ?? ''),
    title: String(input?.title ?? ''),
    changeSummary: typeof input?.changeSummary === 'string' ? input.changeSummary : null,
    rules,
    userId: user.id,
  })

  if (result.ok) {
    revalidatePath('/playbooks')
    revalidatePath('/review')
  }
  return result
}
