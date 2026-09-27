import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import type { ReviewRule } from '@aubrey-law/citations/review/types'
import { deriveMatterFacts, type MatterFacts } from '@aubrey-law/citations/review/conditions'
import type { Database } from '@/types/supabase'

/**
 * The review playbooks the Word add-in can run, read from the same
 * `prompts` / `prompt_versions` / `prompt_publications` rows the playbook
 * builder publishes to (`lib/playbooks/publish.ts`).
 *
 * A reader of its own, beside `lib/prompts/repository.ts`, written before the
 * builder moved into Cornerstone. What keeps the two honest is that both
 * validate every body with the one `promptBodySchema` from
 * `@aubrey-law/citations` on every read — a row that drifted out of shape
 * fails loudly here too, rather than running with a rule silently missing.
 */

type Client = SupabaseClient<Database>

export interface ReviewPlaybookSummary {
  slug: string
  title: string
  version: number
  ruleCount: number
}

export interface PublishedReviewPlaybook {
  slug: string
  title: string
  version: number
  versionId: string
  rules: ReviewRule[]
}

/** Every published review playbook, for the pane's picker. Broken rows are left out, not fatal. */
export async function listReviewPlaybooks(client: Client): Promise<ReviewPlaybookSummary[]> {
  const { data: prompts, error } = await client.from('prompts').select('id, slug, title, kind').eq('kind', 'review')
  if (error) throw new Error(`Could not load playbooks: ${error.message}`)
  if (!prompts || prompts.length === 0) return []

  const summaries: ReviewPlaybookSummary[] = []
  for (const prompt of prompts) {
    const published = await loadVersion(client, String(prompt.id), String(prompt.slug), String(prompt.title)).catch(
      () => null,
    )
    if (published) {
      summaries.push({
        slug: published.slug,
        title: published.title,
        version: published.version,
        ruleCount: published.rules.length,
      })
    }
  }
  return summaries.sort((a, b) => a.title.localeCompare(b.title))
}

/** One published review playbook by slug, or null when there is none. */
export async function loadReviewPlaybook(client: Client, slug: string): Promise<PublishedReviewPlaybook | null> {
  const { data: prompt, error } = await client
    .from('prompts')
    .select('id, slug, title, kind')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`Could not look up "${slug}": ${error.message}`)
  if (!prompt || prompt.kind !== 'review') return null
  return loadVersion(client, String(prompt.id), String(prompt.slug), String(prompt.title))
}

async function loadVersion(
  client: Client,
  promptId: string,
  slug: string,
  title: string,
): Promise<PublishedReviewPlaybook | null> {
  const { data: publication, error: publicationError } = await client
    .from('prompt_publications')
    .select('version_id')
    .eq('prompt_id', promptId)
    .maybeSingle()
  if (publicationError) throw new Error(`Could not load the publication for "${slug}": ${publicationError.message}`)
  if (!publication) return null

  const { data: version, error: versionError } = await client
    .from('prompt_versions')
    .select('id, version_number, body')
    .eq('id', publication.version_id)
    .maybeSingle()
  if (versionError) throw new Error(`Could not load "${slug}": ${versionError.message}`)
  if (!version) return null

  const parsed = promptBodySchema.safeParse(version.body)
  if (!parsed.success || parsed.data.kind !== 'review') {
    throw new Error(`Published playbook "${slug}" does not have a valid review body.`)
  }
  return {
    slug,
    title,
    version: Number(version.version_number),
    versionId: String(version.id),
    rules: parsed.data.rules,
  }
}

/**
 * The linked matter's facts for rule conditions, from its current design
 * sheet. Null when there is no sheet — every rule then runs.
 */
export async function loadMatterFacts(client: Client, matterId: string): Promise<MatterFacts | null> {
  const { data, error } = await client
    .from('design_sheets')
    .select('marital_status, is_joint, children, plan_type, assets')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not load the design sheet: ${error.message}`)
  return data ? deriveMatterFacts(data as Record<string, unknown>) : null
}
