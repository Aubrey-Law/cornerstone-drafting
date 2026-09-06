import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadAnyRun } from '@/lib/runs/history'
import { loadFieldAuditFindings } from '@/lib/fieldAudit/history'
import { formatDate } from '@/lib/funding/format'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { FieldAuditRunView } from './FieldAuditRunView'

export const metadata = { title: 'Field audit · Aubrey Law Workbench' }

/**
 * Refreshes this page on the next request at least every 5 seconds, rather
 * than only when Next would otherwise revalidate it. A run that is still
 * `running` needs the page to keep catching up with it — the tick route
 * (`app/api/cron/tick/route.ts`) works it in the background, on its own
 * schedule, with nothing on this page to push an update. A client polling
 * loop would do the same job; this is the smaller change, and there is no
 * websocket elsewhere in this codebase for a loop to be consistent with.
 */
export const revalidate = 5

/**
 * A field-audit run, read back.
 *
 * Until this route existed, a recorded field audit had nowhere to be seen —
 * `app/prompts/page.tsx` ran one and reported a count, and that was the end
 * of it. This is the field-audit analogue of `app/review/[runId]/page.tsx`:
 * one run, its findings, and the steps that produced them.
 */
export default async function FieldAuditRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const { runId } = await params
  const client = getAdminClient()
  const run = await loadAnyRun(client, runId)
  // A review run has its own home at /review/[runId] — it has a document and
  // a text layer this page knows nothing about how to show.
  if (!run || run.kind !== 'field_audit') notFound()

  const findings = await loadFieldAuditFindings(client, runId)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="space-y-1 border-b border-border px-6 py-4">
        <Link href="/prompts" className="text-xs text-muted-foreground underline underline-offset-4">
          Run a prompt
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          {run.promptSlug ? `${run.promptSlug} v${run.promptVersionNumber}` : 'Field audit'}
        </h1>
        <p className="text-xs text-muted-foreground">
          {run.matterTitle} · {findings.length} findings
          {run.failedCount > 0 ? ` · ${run.failedCount} checks failed` : ''}
          {run.finishedAt ? ` · ${formatDate(run.finishedAt.slice(0, 10))}` : ''}
        </p>
        {/* A check that never ran is not a check that found nothing. */}
        {run.failures.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Did not run:{' '}
            {run.failures.map((failure) => `check ${failure.ruleNumber} (${failure.reason})`).join(', ')}
          </p>
        ) : null}
      </header>
      <FieldAuditRunView runId={run.runId} findings={findings} steps={run.steps} />
    </div>
  )
}
