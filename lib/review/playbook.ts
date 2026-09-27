import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { ReviewPlaybook } from '@aubrey-law/citations/review/types'
import { loadPublishedPrompt } from '@/lib/prompts/repository'

/**
 * The playbook used to be firm content bundled with the repository: a module
 * import of `tools/workflows/review/ma-trust-firm-qa.json`, read through a
 * workspace package so both apps ran the same rules from the same file.
 *
 * It was a module import, deliberately, never a file read at runtime. Next
 * traces a serverless bundle by following imports, so an `fs.readFileSync` is
 * invisible to it: the route builds clean, deploys, and throws ENOENT on the
 * first request. That is exactly what happened once.
 * `outputFileTracingIncludes` was meant to cover it and silently did not —
 * those globs resolve against the project directory, not
 * `outputFileTracingRoot`, so a path written from the repository root matched
 * nothing and no build step said so. An import cannot fail that way, because
 * the compiler puts the bytes in the bundle.
 *
 * The database has neither problem. There is no bundle to trace and no build
 * step whose globs can miss a path — the playbook is a row, fetched the same
 * way in development and in production. That is what let it stop being an
 * import: not that reading it needed to get easier, but that the two ways it
 * used to fail in production (an invisible file read, a tracing config that
 * silently didn't match) simply do not apply to a query.
 *
 * It is still validated on every read, the same as it was validated at
 * import time before. `prompt_versions.body` is jsonb, and nothing about the
 * database — not the composite foreign key from prompts, not publishing —
 * stops a hand-run `update` from putting the wrong shape into an
 * already-published row. A playbook that drifted out of schema would surface
 * as a review that quietly skipped a rule, which is the failure this product
 * cannot have. See `toPublishedPrompt` in `lib/prompts/repository.ts` for
 * where that validation actually happens.
 *
 * One playbook for now: reviewing a Massachusetts revocable trust this firm
 * drafted, against the positions this firm holds. Every draft here is our
 * own, so a deviation is a template or an edit to fix rather than a point to
 * negotiate. A library with a picker is the authoring phase, which is why
 * prompts live as versioned, publishable rows rather than another import —
 * this is the first prompt to use that shape, not the last.
 */
export const REVIEW_PLAYBOOK_SLUG = 'ma-trust-firm-qa'

/**
 * Loads a published review playbook, validated and ready to run — the firm
 * trust playbook unless another slug is named. Playbooks built in
 * `/playbooks` are chosen by slug on the review screen.
 *
 * Throws when nothing is published under `REVIEW_PLAYBOOK_SLUG` — there is
 * no reasonable fallback for "review the document against nothing" — and
 * throws when the published prompt exists but is not a review prompt, which
 * would otherwise run a field-audit body's `checks` through code built for a
 * review body's `rules`.
 */
export async function loadReviewPlaybook(
  client: SupabaseClient<GeneratedDatabase>,
  slug: string = REVIEW_PLAYBOOK_SLUG,
): Promise<ReviewPlaybook> {
  const prompt = await loadPublishedPrompt(client, slug)
  if (!prompt) {
    throw new Error(
      `No published prompt named "${slug}". Publish a review prompt with that slug before running a review.`,
    )
  }
  if (prompt.body.kind !== 'review') {
    throw new Error(
      `Prompt "${slug}" is published as a "${prompt.body.kind}" prompt, not a review playbook.`,
    )
  }

  return {
    slug: prompt.slug,
    title: prompt.title,
    version: prompt.versionNumber,
    rules: prompt.body.rules,
  }
}
