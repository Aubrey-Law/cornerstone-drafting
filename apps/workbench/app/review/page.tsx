import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadReviewPlaybook, REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadRunSummaries } from '@/lib/review/history'
import { loadReviewableByMatter } from '@/lib/review/matterDocuments'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { ReviewWorkspace } from './ReviewWorkspace'

export const metadata = { title: 'Review a draft · Aubrey Law Workbench' }

/**
 * The findings workspace.
 *
 * The playbook is read on the server so the screen can name the rules it is
 * about to apply before anything is uploaded — an attorney should know what is
 * being checked, not just what came back.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ playbook?: string | string[] }>
}) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const client = getAdminClient()
  // Every published review playbook is offered; `?playbook=` picks one, and an
  // unknown slug falls back to the firm trust playbook rather than erroring.
  const reviewPlaybooks = (await loadPublishedPrompts(client))
    .filter((prompt) => prompt.body.kind === 'review')
    .map((prompt) => ({ slug: prompt.slug, title: prompt.title }))
  const requested = (await searchParams)?.playbook
  const requestedSlug = typeof requested === 'string' ? requested : null
  const slug =
    requestedSlug && reviewPlaybooks.some((p) => p.slug === requestedSlug) ? requestedSlug : REVIEW_PLAYBOOK_SLUG
  const playbook = await loadReviewPlaybook(client, slug)
  // Every draft reviewed here is the firm's own and already filed, so the
  // normal path is choosing one rather than uploading it.
  const matters = await loadReviewableByMatter(client)
  const runs = await loadRunSummaries(client, 15)

  return (
    <ReviewWorkspace
      runs={runs}
      matters={matters.map((matter) => ({
        matterId: matter.matterId,
        title: matter.title,
        documents: matter.documents.map((document) => ({
          versionId: document.versionId,
          name: document.name,
          kind: document.source.kind,
        })),
      }))}
      playbooks={reviewPlaybooks}
      playbook={{
        slug: playbook.slug,
        title: playbook.title,
        version: playbook.version,
        rules: playbook.rules.map((rule) => ({
          number: rule.number,
          risk: rule.risk,
          statement: rule.statement,
        })),
      }}
    />
  )
}
