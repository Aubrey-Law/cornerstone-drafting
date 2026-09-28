'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { publishReviewPlaybook, type DraftRule, type PublishResult } from '@/lib/playbooks/publish'
import { reviewClient } from '@/lib/review/staff'
import { ruleConditionSchema } from '@aubrey-law/citations/review/conditions'

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
 * Checks the caller itself: a server action is a public endpoint, so the page
 * it was rendered from having been gated proves nothing about the request.
 * The argument is re-read field by field for the same reason; its type is a
 * promise the browser made, not one it has to keep.
 */
export async function publishPlaybook(input: PublishPlaybookInput): Promise<PublishResult> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { ok: false, message: 'You are not signed in as staff.' }
  }

  const rawRules: unknown[] = Array.isArray(input?.rules) ? input.rules : []
  const rules: DraftRule[] = []
  for (const raw of rawRules) {
    const rule = (raw ?? {}) as Record<string, unknown>
    const statement = typeof rule.statement === 'string' ? rule.statement : ''
    const risk = rule.risk as DraftRule['risk']
    if (!statement.trim() || !RISKS.includes(risk)) {
      return { ok: false, message: `Rule ${rules.length + 1} needs a statement and a risk level.` }
    }
    const conditions = ruleConditionSchema.array().safeParse(rule.conditions ?? [])
    if (!conditions.success) {
      return { ok: false, message: `Rule ${rules.length + 1} has a condition the review cannot test.` }
    }
    rules.push({
      title: typeof rule.title === 'string' ? rule.title : null,
      statement,
      risk,
      preferredLanguage: typeof rule.preferredLanguage === 'string' ? rule.preferredLanguage : null,
      conditions: conditions.data,
    })
  }

  const result = await publishReviewPlaybook(reviewClient(), {
    slug: String(input?.slug ?? ''),
    title: String(input?.title ?? ''),
    changeSummary: typeof input?.changeSummary === 'string' ? input.changeSummary : null,
    rules,
    userId,
  })

  if (result.ok) {
    revalidatePath('/admin/playbooks')
    revalidatePath('/admin/review/new')
  }
  return result
}
