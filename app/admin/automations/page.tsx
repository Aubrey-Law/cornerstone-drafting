import { AlertTriangle } from 'lucide-react'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { listAutomationRules } from '@/lib/automations/server'
import { AutomationsClient, type AutomationRuleView } from './AutomationsClient'
import { ApprovalInbox, type ApprovalProposal } from '@/app/admin/components/ApprovalInbox'
import { getCachedClaims } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export default async function AutomationsPage() {
  const auth = await getCachedClaims()
  const [rules, failedJobs, pendingResult, executionResult] = await Promise.all([
    listAutomationRules().catch(() => []),
    getAdminClient().from('workflow_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    getAdminClient().from('action_proposals')
      .select('id, action_key, risk, display_summary, confirmation_policy, created_at, source')
      .eq('actor_id', auth?.id ?? '00000000-0000-0000-0000-000000000000')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    getAdminClient().from('action_executions')
      .select('id, action_key, risk, status, error_summary, created_at')
      .eq('actor_id', auth?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false }).limit(10),
  ])
  // A successful retry resolves its prior failure. Count only rules whose
  // latest run is failed instead of treating immutable failure history as
  // active work forever.
  const failedCount = (failedJobs.count ?? 0) + rules.filter(rule => (
    rule.last_failure_at && (!rule.last_success_at || rule.last_failure_at > rule.last_success_at)
  )).length
  const pending = pendingResult.data ?? []
  const executions = executionResult.data ?? []

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1240px]">
      <PageHeader
        eyebrow="Operations"
        title="Automations"
        description="See what runs, test changes without side effects, pause rules, and surface failures instead of letting them disappear."
      />

      {failedCount > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <strong>{failedCount} durable workflow job{failedCount === 1 ? '' : 's'} need attention.</strong>
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Operational control</h2>
          <p className="text-sm text-muted-foreground">System schedules and allowlisted rules share one health, history, approval, and pause surface.</p>
        </div>
        <AutomationsClient initialRules={rules as unknown as AutomationRuleView[]} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card id="pending-approvals">
          <CardHeader>
            <CardTitle className="text-base">Pending approvals</CardTitle>
            <CardDescription>Prepared actions still waiting for an authorized user.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApprovalInbox initialProposals={pending as ApprovalProposal[]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution audit</CardTitle>
            <CardDescription>Recent idempotent action results. Sensitive payloads are not logged here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {executions.length ? executions.map(execution => (
              <div key={execution.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><strong>{execution.action_key}</strong><Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{execution.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{execution.risk.replace('_', ' ')} · {new Date(execution.created_at).toLocaleString()}</p>
                {execution.error_summary && <p className="mt-1 text-xs text-destructive">{execution.error_summary}</p>}
              </div>
            )) : <p className="text-sm text-muted-foreground">No registered actions have executed yet.</p>}
          </CardContent>
        </Card>
      </section>
    </AdminPageShell>
  )
}
