import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadMattersWithDesignSheets } from '@/lib/prompts/designSheet'
import { loadFieldAuditRunSummaries } from '@/lib/fieldAudit/history'
import { loadUnresolvedBlockers } from '@/lib/runs/advisory'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { FieldAuditWorkspace } from './FieldAuditWorkspace'

export const dynamic = 'force-dynamic'

/**
 * Field audits: a published `field_audit` prompt run against a matter's design
 * sheet rather than a document — a review has its own pages at `/admin/review`.
 * Ported from the workbench's `/prompts`.
 */
export default async function FieldAuditsPage() {
  await requireStaffPage()

  const client = reviewClient()
  const [prompts, matters, runs, unresolvedBlockers] = await Promise.all([
    loadPublishedPrompts(client),
    loadMattersWithDesignSheets(client),
    loadFieldAuditRunSummaries(client, 15),
    loadUnresolvedBlockers(client),
  ])

  return (
    <FieldAuditWorkspace
      prompts={prompts.flatMap(prompt =>
        prompt.body.kind === 'field_audit'
          ? [{ slug: prompt.slug, title: prompt.title, checkCount: prompt.body.checks.length }]
          : [],
      )}
      matters={matters}
      runs={runs}
      unresolvedBlockers={unresolvedBlockers}
    />
  )
}
