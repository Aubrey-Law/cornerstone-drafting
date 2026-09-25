import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { reviewBodySchema } from '@aubrey-law/citations/prompt/body'
import type { ReviewRule } from '@aubrey-law/citations/review/types'
import type { RuleCondition } from '@aubrey-law/citations/review/conditions'
import { SLUG_PATTERN } from './slug'

/**
 * Publishing a review playbook from the builder.
 *
 * Until now the only way a playbook reached `prompt_versions` was a hand-written
 * migration (`20261028010000_seed_review_playbook.sql`). This is the same write,
 * made from the app: a new immutable version row, then the publication pointer
 * moved to it. Earlier versions are never edited — runs pin
 * `prompt_version_id`, and a finding must stay answerable against the exact
 * wording that produced it.
 *
 * Split pure from queried, as `lib/prompts/repository.ts` is: the body, its
 * hash and the slug rule are asserted directly; only `publishReviewPlaybook`
 * needs a database.
 */

export interface DraftRule {
  statement: string
  risk: ReviewRule['risk']
  preferredLanguage?: string | null
  /** When the rule applies. Empty or absent means always, and is not stored. */
  conditions?: RuleCondition[]
}

/**
 * The body a version stores. Rules are renumbered 1..n in the order given, so
 * the attorney's ordering on screen is the playbook's order — and a rule's
 * number is only meaningful within its own version, which is how runs already
 * read it.
 *
 * The returned object is zod's parse of the body, so its key order is the
 * schema's — deterministic, which is what matters, because the content hash
 * is taken over `JSON.stringify` of exactly this object, as the seeded
 * version's was. A rule with no conditions carries no `conditions` key, so a
 * condition-free playbook hashes as it would have before conditions existed.
 */
export function buildReviewBody(rules: DraftRule[]) {
  const body = {
    kind: 'review' as const,
    inputs: [] as never[],
    rules: rules.map((rule, index) => {
      const preferred = rule.preferredLanguage?.trim()
      return {
        number: String(index + 1),
        risk: rule.risk,
        statement: rule.statement.trim(),
        ...(preferred ? { preferredLanguage: preferred } : {}),
        ...(rule.conditions && rule.conditions.length > 0 ? { conditions: rule.conditions } : {}),
      }
    }),
  }
  // Refused here, before any write: an empty statement or unknown risk would
  // otherwise fail `toPublishedPrompt` on every read after publication.
  return reviewBodySchema.parse(body)
}

export function contentHashFor(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
}

export interface PublishInput {
  slug: string
  title: string
  rules: DraftRule[]
  changeSummary: string | null
  userId: string
}

export type PublishResult =
  | { ok: true; slug: string; versionNumber: number; ruleCount: number }
  | { ok: false; message: string }

export async function publishReviewPlaybook(
  client: SupabaseClient<WorkbenchDatabase>,
  input: PublishInput,
): Promise<PublishResult> {
  const slug = input.slug.trim()
  const title = input.title.trim()
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, message: 'The playbook id may use only lowercase letters, numbers and single hyphens.' }
  }
  if (!title) return { ok: false, message: 'Give the playbook a title.' }
  if (input.rules.length === 0) return { ok: false, message: 'A playbook needs at least one rule.' }

  let body
  try {
    body = buildReviewBody(input.rules)
  } catch {
    return { ok: false, message: 'Every rule needs a statement, a risk level, and conditions that name a known matter fact.' }
  }

  const { data: existing, error: existingError } = await client
    .from('prompts')
    .select('id, kind, title')
    .eq('slug', slug)
    .maybeSingle()
  if (existingError) return { ok: false, message: `Could not look up "${slug}": ${existingError.message}` }

  let promptId: string
  if (existing) {
    if (existing.kind !== 'review') {
      return { ok: false, message: `"${slug}" is already used by a ${existing.kind} prompt. Choose another id.` }
    }
    promptId = existing.id
    if (existing.title !== title) {
      const { error } = await client.from('prompts').update({ title }).eq('id', promptId)
      if (error) return { ok: false, message: `Could not rename the playbook: ${error.message}` }
    }
  } else {
    const { data: created, error } = await client
      .from('prompts')
      .insert({ slug, title, kind: 'review', is_system: false })
      .select('id')
      .single()
    if (error || !created) {
      return { ok: false, message: `Could not create the playbook: ${error?.message ?? 'no row returned'}` }
    }
    promptId = created.id
  }

  const { data: latest, error: latestError } = await client
    .from('prompt_versions')
    .select('version_number')
    .eq('prompt_id', promptId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) return { ok: false, message: `Could not read the playbook's versions: ${latestError.message}` }

  // `unique (prompt_id, version_number)` settles a race between two publishes:
  // the loser's insert fails and says so, rather than overwriting anything.
  const versionNumber = (latest?.version_number ?? 0) + 1
  const { data: version, error: versionError } = await client
    .from('prompt_versions')
    .insert({
      prompt_id: promptId,
      kind: 'review',
      version_number: versionNumber,
      body,
      content_hash: contentHashFor(body),
      change_summary: input.changeSummary?.trim() || null,
      validation_status: 'valid',
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (versionError || !version) {
    return { ok: false, message: `Could not save version ${versionNumber}: ${versionError?.message ?? 'no row returned'}` }
  }

  // Last, so a failure anywhere above leaves the published version untouched.
  const { error: publishError } = await client
    .from('prompt_publications')
    .upsert(
      {
        prompt_id: promptId,
        version_id: version.id,
        published_at: new Date().toISOString(),
        published_by: input.userId,
      },
      { onConflict: 'prompt_id' },
    )
  if (publishError) {
    return {
      ok: false,
      message: `Version ${versionNumber} was saved but not published: ${publishError.message}`,
    }
  }

  return { ok: true, slug, versionNumber, ruleCount: body.rules.length }
}
