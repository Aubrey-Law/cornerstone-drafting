import { reviewPlaybookSchema, type ReviewPlaybook } from '@aubrey-law/citations/review/types'
import playbookJson from '@aubrey-law/system-workflows/review/ma-trust-third-party-draft.json'

/**
 * The playbook is firm content, bundled with the repository rather than typed
 * into a screen, and read through the workspace package so both apps run the
 * same rules from the same file.
 *
 * Imported as a module, never read from disk. Next traces a serverless bundle
 * by following imports, so an `fs.readFileSync` is invisible to it: the route
 * builds clean, deploys, and throws ENOENT on the first request. That is
 * exactly what happened. `outputFileTracingIncludes` was meant to cover it and
 * silently did not — those globs resolve against the project directory, not
 * `outputFileTracingRoot`, so a path written from the repository root matched
 * nothing and no build step said so. An import cannot fail that way, because
 * the compiler puts the bytes in the bundle.
 *
 * It is still validated at load. The file is edited by hand, and a playbook
 * that drifts out of schema would otherwise surface as a review that quietly
 * skipped a rule — the failure this product cannot have.
 *
 * One playbook for now: reviewing a Massachusetts revocable trust drafted
 * elsewhere. A library with a picker is the authoring phase, and will be
 * database-backed rather than another import.
 */
export const REVIEW_PLAYBOOK_SLUG = 'ma-trust-third-party-draft'

let cached: ReviewPlaybook | null = null

export function loadReviewPlaybook(): ReviewPlaybook {
  if (cached) return cached
  const parsed = reviewPlaybookSchema.safeParse(playbookJson)
  if (!parsed.success) {
    throw new Error(
      `Review playbook ${REVIEW_PLAYBOOK_SLUG} does not match the expected shape: ${parsed.error.message}`,
    )
  }
  cached = parsed.data
  return cached
}
