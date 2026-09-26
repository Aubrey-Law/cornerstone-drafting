import Link from 'next/link'
import { describeCondition } from '@aubrey-law/citations/review/conditions'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadReviewableByMatter } from '@/lib/review/matterDocuments'
import { REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { NewReviewForm } from './NewReviewForm'

export const dynamic = 'force-dynamic'

/**
 * Starting a review: a published playbook against a current document on a
 * hired matter, or against a file uploaded for the purpose (a prior plan).
 * `?matter=` preselects a matter, as the matter's Reviews tab links here.
 */
export default async function NewReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ matter?: string | string[] }>
}) {
  await requireStaffPage()
  const client = reviewClient()

  const playbooks = (await loadPublishedPrompts(client))
    .filter(prompt => prompt.body.kind === 'review')
    .map(prompt => ({
      slug: prompt.slug,
      title: prompt.title,
      rules:
        prompt.body.kind === 'review'
          ? prompt.body.rules.map(rule => ({
              number: rule.number,
              risk: rule.risk,
              statement: rule.statement,
              appliesWhen: (rule.conditions ?? []).map(describeCondition),
            }))
          : [],
    }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const matters = (await loadReviewableByMatter(client))
    .filter(matter => matter.documents.length > 0)
    .map(matter => ({
      matterId: matter.matterId,
      title: matter.title,
      documents: matter.documents.map(document => ({ versionId: document.versionId, name: document.name })),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const requested = (await searchParams)?.matter
  const initialMatterId = typeof requested === 'string' && matters.some(m => m.matterId === requested) ? requested : null
  const defaultSlug = playbooks.some(p => p.slug === REVIEW_PLAYBOOK_SLUG) ? REVIEW_PLAYBOOK_SLUG : (playbooks[0]?.slug ?? '')

  return (
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <Link href="/admin/review" className="text-xs text-muted-foreground underline underline-offset-4">
          Reviews
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Start a review</h1>
        <p className="text-sm text-muted-foreground">
          Runs a playbook against one document. Each finding quotes the passage it is about, checked against the
          document&apos;s own text. The review is saved and fills in over a minute or two.
        </p>
      </header>
      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No review playbook is published yet.</p>
      ) : (
        <NewReviewForm
          playbooks={playbooks}
          defaultSlug={defaultSlug}
          matters={matters}
          initialMatterId={initialMatterId}
        />
      )}
    </div>
  )
}
