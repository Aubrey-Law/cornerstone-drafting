import { MatterWorkspaceShell } from '@/components/matter/MatterWorkspaceShell'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { describeCondition } from '@aubrey-law/citations/review/conditions'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadReviewableByMatter } from '@/lib/review/matterDocuments'
import { REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { NewReviewForm } from './NewReviewForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Start a review' }

/**
 * Starting a review: a published playbook against a current document on a
 * hired matter, or against a file uploaded for the purpose (a prior plan).
 * `?matter=` preselects a matter, as the matter's Reviews tab links here;
 * `?playbook=` preselects a playbook, as the builder links here after publishing.
 */
export default async function NewReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ matter?: string | string[]; playbook?: string | string[] }>
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
              title: rule.title ?? null,
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

  const params = await searchParams
  const requested = params?.matter
  const initialMatterId = typeof requested === 'string' && matters.some(m => m.matterId === requested) ? requested : null
  const requestedPlaybook = params?.playbook
  const defaultSlug =
    typeof requestedPlaybook === 'string' && playbooks.some(p => p.slug === requestedPlaybook)
      ? requestedPlaybook
      : playbooks.some(p => p.slug === REVIEW_PLAYBOOK_SLUG)
        ? REVIEW_PLAYBOOK_SLUG
        : (playbooks[0]?.slug ?? '')

  return (
    <div className="space-y-4">
      {initialMatterId && <MatterWorkspaceShell matterId={initialMatterId} active="reviews" />}
      <PageHeader
        title="Start a review"
        description="Runs a playbook against one document. Each finding quotes the passage it is about, checked against the document's own text. The review is saved and fills in over a minute or two."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/review">
                <ArrowLeft className="size-4" aria-hidden />
                All reviews
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/playbooks">Build a playbook</Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}
