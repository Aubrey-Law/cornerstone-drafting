import { Activity, AlertTriangle, Clock3, Workflow } from 'lucide-react'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { listAutomationRules } from '@/lib/automations/server'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'
import { AutomationsClient, type AutomationRuleView } from './AutomationsClient'

export const dynamic = 'force-dynamic'

export default async function AutomationsPage() {
  const [rules, failed, pendingResult, executionResult] = await Promise.all([
    listAutomationRules().catch(() => []),
    getAdminClient().from('workflow_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    getAdminClient().from('action_proposals')
      .select('id, action_key, risk, display_summary, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    getAdminClient().from('action_executions')
      .select('id, action_key, risk, status, error_summary, created_at')
      .order('created_at', { ascending: false }).limit(10),
  ])
  const failedCount = failed.count ?? 0
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
          <h2 className="text-base font-semibold">Configurable rules</h2>
          <p className="text-sm text-muted-foreground">Templates begin paused. “Enable safely” starts in dry-run mode.</p>
        </div>
        <AutomationsClient initialRules={rules as unknown as AutomationRuleView[]} />
      </section>

      <section className="mt-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold">System schedules</h2>
          <p className="text-sm text-muted-foreground">Deployment-managed jobs already operating across Cornerstone.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SYSTEM_AUTOMATIONS.map(automation => (
            <Card key={automation.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2"><Workflow className="h-4 w-4" />{automation.name}</span>
                  <Badge variant="outline">System</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{automation.schedule}</CardDescription>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5" />Managed by deployment configuration</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending approvals</CardTitle>
            <CardDescription>Prepared actions still waiting for an authorized user.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.length ? pending.map(proposal => (
              <div key={proposal.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><strong>{proposal.display_summary}</strong><Badge variant="outline">{proposal.risk.replace('_', ' ')}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{proposal.action_key} · {new Date(proposal.created_at).toLocaleString()}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">No actions are waiting for approval.</p>}
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
