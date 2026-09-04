import fs from 'node:fs'
import path from 'node:path'
import { systemWorkflowsRoot } from '@aubrey-law/system-workflows/root'
import { reviewPlaybookSchema, type ReviewPlaybook } from '@aubrey-law/citations/review/types'

/**
 * The playbook is firm content, bundled with the repository rather than typed
 * into a screen, and read through the workspace package so both apps run the
 * same rules from the same file.
 *
 * One playbook for now — reviewing a Massachusetts revocable trust drafted
 * elsewhere. A library with a picker is the authoring phase; hard-coding the
 * slug here is honest about there being one.
 */
export const REVIEW_PLAYBOOK_SLUG = 'ma-trust-third-party-draft'

export function loadReviewPlaybook(slug: string = REVIEW_PLAYBOOK_SLUG): ReviewPlaybook {
  const file = path.join(systemWorkflowsRoot, 'review', `${slug}.json`)
  const parsed = reviewPlaybookSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!parsed.success) {
    // A playbook that drifts out of schema would otherwise surface as a review
    // that quietly skipped a rule, which is the failure this product cannot have.
    throw new Error(`Review playbook ${slug} does not match the expected shape: ${parsed.error.message}`)
  }
  return parsed.data
}
