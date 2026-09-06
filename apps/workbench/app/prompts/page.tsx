import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadMattersWithDesignSheets } from '@/lib/prompts/designSheet'
import { loadFieldAuditRunSummaries } from '@/lib/fieldAudit/history'
import { loadUnresolvedBlockers } from '@/lib/runs/advisory'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { PromptsWorkspace } from './PromptsWorkspace'

export const metadata = { title: 'Run a prompt · Aubrey Law Workbench' }

/**
 * `runAudit` (app/prompts/actions.ts) calls the model once per check in a
 * prompt, and a "use server" file may only export async functions — so the
 * segment's timeout budget is declared here instead, the same as
 * app/api/staff/review/route.ts's `maxDuration` covers the review path's own
 * model calls.
 */
export const maxDuration = 300

/**
 * The prompt-running workspace.
 *
 * `loadPublishedPrompts` returns every published prompt regardless of kind —
 * review prompts included — because a review already has its own dedicated
 * page (`/review`) built around a document, not a matter. This page narrows
 * to `field_audit` prompts, the kind that runs against a matter's declared
 * facts rather than a document.
 */
export default async function PromptsPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const client = getAdminClient()
  const allPrompts = await loadPublishedPrompts(client)
  const fieldAuditPrompts = allPrompts.filter(
    (prompt): prompt is typeof prompt & { body: { kind: 'field_audit' } } => prompt.body.kind === 'field_audit',
  )
  const matters = await loadMattersWithDesignSheets(client)
  const runs = await loadFieldAuditRunSummaries(client, 15)
  const unresolvedBlockers = await loadUnresolvedBlockers(client)

  return (
    <PromptsWorkspace
      prompts={fieldAuditPrompts.map((prompt) => ({
        slug: prompt.slug,
        title: prompt.title,
        checkCount: prompt.body.checks.length,
      }))}
      matters={matters}
      runs={runs}
      unresolvedBlockers={unresolvedBlockers}
    />
  )
}
