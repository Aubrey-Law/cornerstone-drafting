import { MergeReviewClient } from './MergeReviewClient'

export const dynamic = 'force-dynamic'

/**
 * Review queue for duplicate people (step 6 of
 * docs/matter-contacts-migration.md). Candidates are proposed on exact email
 * match; merging is a deliberate per-pair action, never a sweep.
 */
export default function ContactMergeReviewPage() {
  return <MergeReviewClient />
}
