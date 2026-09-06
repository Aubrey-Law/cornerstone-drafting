import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { promptBodySchema, type PromptBody } from '@aubrey-law/citations/prompt/body'

/**
 * A published prompt: the version a `prompt_publications` row currently
 * points at, with its body validated and typed.
 *
 * Split pure from queried, the way `lib/auth/session.ts` and
 * `lib/supabase/roles.ts` do — `toPublishedPrompt` is asserted directly
 * against plain objects, and the query is the only part that needs a
 * database.
 */
export interface PublishedPrompt {
  versionId: string
  /**
   * The *prompt*, not the version. The withdrawal rule in
   * `lib/fieldAudit/tasks.ts` scopes a run's candidates to its own prompt, and
   * scoping by version instead would strand every task the moment a prompt is
   * republished — version 4 must still retire version 3's tasks, because it is
   * a newer answer to the same question.
   */
  promptId: string
  versionNumber: number
  slug: string
  title: string
  body: PromptBody
}

/**
 * Validates a version row into the shape the app runs.
 *
 * `body` is jsonb. Publishing already validates it against `promptBodySchema`
 * (see the publish path), but that does not make a published row trustworthy
 * forever — nothing stops a hand-run `update prompt_versions set body = ...`
 * from putting the wrong shape into a row a publication already points at,
 * and Postgres has no way to enforce a zod schema on a jsonb column. So this
 * validates again, on every read. The alternative is a prompt that silently
 * skipped a rule because its body drifted out of shape after publication —
 * exactly the failure this product cannot have.
 *
 * The kind check is the same story from a different angle: the composite
 * foreign key from `prompt_versions` to `prompts(id, kind)` stops a version
 * row from claiming a different kind than its prompt, but it says nothing
 * about the *body* — a review prompt's version could still be published with
 * a `body.kind` of `field_audit` typed in by hand, and the two checks below
 * are what would catch that before it ran as a review.
 */
export function toPublishedPrompt(row: {
  id: string
  version_number: number
  body: unknown
  prompt_id: string
  prompts: { slug: string; title: string; kind: string } | null
}): PublishedPrompt {
  const slug = row.prompts?.slug ?? `(prompt for version ${row.id})`

  const parsed = promptBodySchema.safeParse(row.body)
  if (!parsed.success) {
    throw new Error(
      `Published prompt "${slug}" (version ${row.id}) has a body that does not match the expected shape: ${parsed.error.message}`,
    )
  }

  if (!row.prompts) {
    throw new Error(`Prompt version ${row.id} has no prompt to belong to.`)
  }

  if (parsed.data.kind !== row.prompts.kind) {
    throw new Error(
      `Published prompt "${row.prompts.slug}" is recorded as kind "${row.prompts.kind}", but its body claims kind "${parsed.data.kind}".`,
    )
  }

  return {
    versionId: row.id,
    promptId: row.prompt_id,
    versionNumber: row.version_number,
    slug: row.prompts.slug,
    title: row.prompts.title,
    body: parsed.data,
  }
}

/**
 * The published version of one prompt, by slug — or null when the prompt
 * does not exist, or exists but has never been published.
 *
 * Three plain queries rather than a PostgREST embedded select
 * (`prompt_publications(prompt_id, prompts(slug, ...))`): the embedded form
 * cannot be checked column-by-column by `scripts/lib/queryReferences.mjs`,
 * which is what backs `query-columns.test.ts` and `checkDbColumns.mjs`. The
 * same trade the rest of this codebase already makes, see
 * `lib/review/matterDocuments.ts` and `lib/review/history.ts`.
 */
export async function loadPublishedPrompt(
  client: SupabaseClient<WorkbenchDatabase>,
  slug: string,
): Promise<PublishedPrompt | null> {
  const sb = client

  const { data: promptRow, error: promptError } = await sb
    .from('prompts')
    .select('id, slug, title, kind')
    .eq('slug', slug)
    .maybeSingle()
  if (promptError) throw new Error(`Could not look up the prompt "${slug}": ${promptError.message}`)
  if (!promptRow) return null

  const { data: publicationRow, error: publicationError } = await sb
    .from('prompt_publications')
    .select('version_id')
    .eq('prompt_id', promptRow.id)
    .maybeSingle()
  if (publicationError) {
    throw new Error(`Could not look up the publication for "${slug}": ${publicationError.message}`)
  }
  if (!publicationRow) return null

  const { data: versionRow, error: versionError } = await sb
    .from('prompt_versions')
    .select('id, version_number, body')
    .eq('id', publicationRow.version_id)
    .maybeSingle()
  if (versionError) {
    throw new Error(`Could not load the published version of "${slug}": ${versionError.message}`)
  }
  if (!versionRow) return null

  return toPublishedPrompt({
    id: versionRow.id,
    version_number: versionRow.version_number,
    body: versionRow.body,
    prompt_id: promptRow.id,
    prompts: { slug: promptRow.slug, title: promptRow.title, kind: promptRow.kind },
  })
}

/**
 * The prompt version a run was checked against, by *id* — never by slug, and
 * never the version a slug currently publishes.
 *
 * `loadPublishedPrompt` answers "what does this prompt say right now", which
 * is the wrong question for a retry: a retry finishes the run it belongs to,
 * against the exact wording that produced its other findings, even if the
 * prompt has since been edited and republished. `workflow_runs.prompt_version_id`
 * is what pins that wording, so this loader reads `prompt_versions` directly
 * by that id rather than going through `prompt_publications` at all.
 */
export async function loadPromptVersionById(
  client: SupabaseClient<WorkbenchDatabase>,
  versionId: string,
): Promise<PublishedPrompt | null> {
  const sb = client

  const { data: versionRow, error: versionError } = await sb
    .from('prompt_versions')
    .select('id, version_number, body, prompt_id')
    .eq('id', versionId)
    .maybeSingle()
  if (versionError) throw new Error(`Could not load prompt version ${versionId}: ${versionError.message}`)
  if (!versionRow) return null

  const { data: promptRow, error: promptError } = await sb
    .from('prompts')
    .select('slug, title, kind')
    .eq('id', versionRow.prompt_id)
    .maybeSingle()
  if (promptError) throw new Error(`Could not load the prompt for version ${versionId}: ${promptError.message}`)

  return toPublishedPrompt({
    id: versionRow.id,
    version_number: versionRow.version_number,
    body: versionRow.body,
    prompt_id: String(versionRow.prompt_id),
    prompts: promptRow ? { slug: promptRow.slug, title: promptRow.title, kind: promptRow.kind } : null,
  })
}

/**
 * Every prompt that currently has a publication — the library a picker
 * screen lists, once there is one.
 */
export async function loadPublishedPrompts(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<PublishedPrompt[]> {
  const sb = client

  const { data: publications, error: publicationsError } = await sb
    .from('prompt_publications')
    .select('prompt_id, version_id')
  if (publicationsError) {
    throw new Error(`Could not load prompt publications: ${publicationsError.message}`)
  }
  if (!publications || publications.length === 0) return []

  const promptIds = [...new Set(publications.map((p) => String(p.prompt_id)))]
  const versionIds = [...new Set(publications.map((p) => String(p.version_id)))]

  const [{ data: prompts, error: promptsError }, { data: versions, error: versionsError }] = await Promise.all([
    sb.from('prompts').select('id, slug, title, kind').in('id', promptIds),
    sb.from('prompt_versions').select('id, version_number, body').in('id', versionIds),
  ])
  if (promptsError) throw new Error(`Could not load prompts: ${promptsError.message}`)
  if (versionsError) throw new Error(`Could not load prompt versions: ${versionsError.message}`)

  const promptById = new Map((prompts ?? []).map((p) => [String(p.id), p]))
  const versionById = new Map((versions ?? []).map((v) => [String(v.id), v]))

  return publications.map((publication) => {
    const versionId = String(publication.version_id)
    const version = versionById.get(versionId)
    if (!version) {
      throw new Error(
        `Prompt ${publication.prompt_id} is published against version ${versionId}, which no longer exists.`,
      )
    }
    const prompt = promptById.get(String(publication.prompt_id)) ?? null
    return toPublishedPrompt({
      id: version.id,
      version_number: version.version_number,
      body: version.body,
      prompt_id: String(publication.prompt_id),
      prompts: prompt ? { slug: prompt.slug, title: prompt.title, kind: prompt.kind } : null,
    })
  })
}
