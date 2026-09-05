import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { loadRun } from '@/lib/review/history'
import { isCitable } from '@/lib/review/order'
import { formatDate } from '@/lib/funding/format'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { StoredFindings } from './StoredFindings'

export const metadata = { title: 'Review · Aubrey Law Workbench' }

export default async function StoredRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const { runId } = await params
  const run = await loadRun(getAdminClient(), runId)
  if (!run) notFound()

  const cited = run.findings.filter(isCitable).length
  const refused = run.findings.filter((f) => f.citationRefusal !== null).length

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="space-y-1 border-b border-border px-6 py-4">
        <Link href="/review" className="text-xs text-muted-foreground underline underline-offset-4">
          Review
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          {run.playbookSlug} v{run.playbookVersion}
        </h1>
        <p className="text-xs text-muted-foreground">
          {run.findings.length} findings · {cited} cited · {refused} citations rejected
          {run.failedCount > 0 ? ` · ${run.failedCount} rules failed` : ''}
          {run.finishedAt ? ` · ${formatDate(run.finishedAt.slice(0, 10))}` : ''}
        </p>
        {/* A run that lost a rule says so here rather than in a count nobody
            reads, because a rule that never ran is not a rule that found
            nothing. */}
        {run.failures.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Did not run:{' '}
            {run.failures.map((failure) => `rule ${failure.ruleNumber} (${failure.reason})`).join(', ')}
          </p>
        ) : null}
      </header>
      <StoredFindings runId={run.runId} findings={run.findings} layer={run.layer} />
    </div>
  )
}
