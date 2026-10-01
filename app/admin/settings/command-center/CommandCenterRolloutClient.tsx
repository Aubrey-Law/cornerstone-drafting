'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkGraphReconciliation } from '@/lib/work/reconciliation'
import type {
  CommandCenterRolloutReadiness,
  WorkGraphReconciliationRun,
} from '@/lib/work/rollout'

interface AuditResponse {
  run: WorkGraphReconciliationRun
  readiness: CommandCenterRolloutReadiness
  reconciliation: WorkGraphReconciliation | null
  error?: string
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(value))
}

function CountList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      <ul className="mt-1 max-h-36 space-y-1 overflow-auto font-mono text-micro text-muted-foreground">
        {values.slice(0, 25).map(value => <li key={value}>{value}</li>)}
      </ul>
      {values.length > 25 && <p className="mt-1 text-micro text-muted-foreground">And {values.length - 25} more</p>}
    </div>
  )
}

export function CommandCenterRolloutClient({
  initialEnabled,
  initialEnabledAt,
  initialReadiness,
  initialRuns,
  isAdministrator,
}: {
  initialEnabled: boolean
  initialEnabledAt: string | null
  initialReadiness: CommandCenterRolloutReadiness
  initialRuns: WorkGraphReconciliationRun[]
  isAdministrator: boolean
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [enabledAt, setEnabledAt] = useState(initialEnabledAt)
  const [readiness, setReadiness] = useState(initialReadiness)
  const [runs, setRuns] = useState(initialRuns)
  const [detail, setDetail] = useState<WorkGraphReconciliation | null>(null)
  const [busy, setBusy] = useState<'audit' | 'toggle' | null>(null)

  async function runAudit() {
    setBusy('audit')
    try {
      const response = await fetch('/api/admin/work-items/reconciliation', { method: 'POST' })
      const body = await response.json().catch(() => ({})) as AuditResponse
      if (!response.ok || !body.run) throw new Error(body.error ?? 'The shadow audit failed')
      setRuns(current => [body.run, ...current.filter(run => run.id !== body.run.id)].slice(0, 20))
      setReadiness(body.readiness)
      setDetail(body.reconciliation)
      toast.success(body.run.readinessPassed ? 'Shadow audit passed' : 'Shadow audit recorded issues to review')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The shadow audit failed')
    } finally {
      setBusy(null)
    }
  }

  async function setRollout(nextEnabled: boolean) {
    setBusy('toggle')
    try {
      const response = await fetch('/api/admin/settings/command-center', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const body = await response.json().catch(() => ({})) as {
        error?: string
        readiness?: CommandCenterRolloutReadiness
        settings?: { command_center_v2_enabled?: boolean; command_center_v2_enabled_at?: string | null }
      }
      if (body.readiness) setReadiness(body.readiness)
      if (!response.ok) throw new Error(body.error ?? 'The rollout setting could not be changed')
      setEnabled(Boolean(body.settings?.command_center_v2_enabled))
      setEnabledAt(body.settings?.command_center_v2_enabled_at ?? null)
      toast.success(nextEnabled ? 'Daily Command Center enabled' : 'Legacy Today restored')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The rollout setting could not be changed')
    } finally {
      setBusy(null)
    }
  }

  const latest = readiness.latest

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current experience</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              {enabled ? <CheckCircle2 className="h-5 w-5 text-green" /> : <Activity className="h-5 w-5 text-muted-foreground" />}
              {enabled ? 'Command Center' : 'Legacy Today'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {enabledAt ? `Parallel run started ${formatTimestamp(enabledAt)}.` : 'The new experience remains opt-in and hidden.'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Latest coverage</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5" />
              {latest ? `${latest.coveragePercent.toFixed(2)}%` : 'Not measured'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {latest ? `${latest.mappedCount} of ${latest.legacyCount} legacy obligations mapped.` : 'Run a shadow audit to establish coverage.'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Clean-streak performance</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gauge className="h-5 w-5" />
              {readiness.p95DurationMs === null ? 'Not measured' : `${readiness.p95DurationMs} ms p95`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Target: no more than 1,500 ms.</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {readiness.ready ? <CheckCircle2 className="h-5 w-5 text-green" /> : <AlertTriangle className="h-5 w-5 text-amber" />}
              Rollout gate {readiness.ready ? 'passed' : 'not yet passed'}
            </CardTitle>
            <CardDescription>Activation requires three repeatable clean samples. Client content and work identifiers are not stored in the ledger.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={runAudit} disabled={busy !== null}>
              {busy === 'audit' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Run shadow audit
            </Button>
            {isAdministrator && (
              <Button
                variant={enabled ? 'outline' : 'default'}
                onClick={() => setRollout(!enabled)}
                disabled={busy !== null || (!enabled && !readiness.ready)}
              >
                {busy === 'toggle' && <Loader2 className="animate-spin" />}
                {enabled ? 'Restore legacy Today' : 'Enable Command Center'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {readiness.criteria.map(criterion => (
              <div key={criterion.key} className="flex gap-2 rounded-lg border p-3">
                {criterion.passed
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                  : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                <div>
                  <p className="text-sm font-medium">{criterion.label}</p>
                  <p className="text-xs text-muted-foreground">{criterion.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {!isAdministrator && <p className="mt-3 text-xs text-muted-foreground">An administrator must activate or disable the firm-wide experience.</p>}
          {enabled && (
            <p className="mt-3 text-xs text-muted-foreground">
              Keep the legacy path available for ten business days. <Link className="underline" href="/admin?legacy=1">Open legacy Today</Link>.
            </p>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest on-demand comparison</CardTitle>
            <CardDescription>Identifiers are shown only in this authenticated response and are not written to the rollout ledger.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <CountList title="Omitted legacy work" values={detail.omittedWorkKeys} />
            <CountList title="Duplicate canonical work" values={detail.duplicateWorkKeys} />
            <CountList title="Additional canonical work" values={detail.additionalCanonicalWorkKeys} />
            <div>
              <p className="text-xs font-medium">Ranking differences</p>
              <p className="mt-1 text-sm text-muted-foreground">{detail.differentlyRanked.length}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent shadow samples</CardTitle>
          <CardDescription>Scheduled audits run once each weekday before the daily digest.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No samples recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Time</th>
                    <th className="px-2 py-2 font-medium">Trigger</th>
                    <th className="px-2 py-2 font-medium">Coverage</th>
                    <th className="px-2 py-2 font-medium">Duration</th>
                    <th className="px-2 py-2 font-medium">Omitted</th>
                    <th className="px-2 py-2 font-medium">Duplicates</th>
                    <th className="px-2 py-2 font-medium">Sources</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="px-2 py-2">{formatTimestamp(run.createdAt)}</td>
                      <td className="px-2 py-2 capitalize">{run.trigger}</td>
                      <td className="px-2 py-2">{run.coveragePercent.toFixed(2)}%</td>
                      <td className="px-2 py-2">{run.durationMs} ms</td>
                      <td className="px-2 py-2">{run.omittedCount}</td>
                      <td className="px-2 py-2">{run.duplicateCount}</td>
                      <td className="px-2 py-2">{run.sourceErrorCodes.length ? run.sourceErrorCodes.join(', ') : 'Healthy'}</td>
                      <td className="px-2 py-2"><Badge variant={run.readinessPassed ? 'outline' : 'destructive'}>{run.readinessPassed ? 'Pass' : 'Review'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Link href="/admin" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">Open Today <ExternalLink className="h-3 w-3" /></Link>
        <Link href="/admin/automations" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">Automation health <ExternalLink className="h-3 w-3" /></Link>
      </div>
    </div>
  )
}
