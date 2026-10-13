'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, FlaskConical, Loader2, Pause, Play, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { describeAutomationSchedule } from '@/lib/automations/scheduleLabel'

export interface AutomationRunView {
  id: string
  status: string
  started_at: string
  finished_at?: string | null
  attempt?: number
  proposed_count?: number
  executed_count?: number
  error_summary?: string | null
  next_retry_at?: string | null
}

export interface AutomationRuleView {
  id: string
  name: string
  description: string | null
  trigger_key: string
  action_key: string
  conditions: Record<string, unknown>
  action_config: Record<string, unknown>
  mode: 'dry_run' | 'live' | 'paused'
  approval_policy: 'automatic' | 'required' | 'prohibited'
  origin: 'system_schedule' | 'rule_template' | 'custom_rule'
  schedule_cron: string | null
  schedule_timezone: string
  next_run_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  consecutive_failures: number
  kill_switch: boolean
  locked: boolean
  max_attempts: number
  lastRun?: AutomationRunView | null
  lastSuccess?: AutomationRunView | null
  lastFailure?: AutomationRunView | null
  pendingApprovals?: number
  recentRuns?: AutomationRunView[]
}

interface DryRunCandidate {
  candidateKey: string
  recordType: string
  recordId: string | null
  title: string
  reason: string
  href: string
  actionKeys: string[]
}

const firmDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/New_York',
})

function formatTime(value?: string | null) {
  return value ? firmDateTimeFormatter.format(new Date(value)) : 'Never'
}

function statusVariant(status?: string): 'default' | 'destructive' | 'outline' | 'secondary' {
  if (status === 'failed') return 'destructive'
  if (status === 'succeeded' || status === 'live') return 'default'
  return 'outline'
}

export function AutomationsClient({ initialRules }: { initialRules: AutomationRuleView[] }) {
  const [rules, setRules] = useState(initialRules)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dryRuns, setDryRuns] = useState<Record<string, DryRunCandidate[]>>({})

  async function updateControl(rule: AutomationRuleView, mode: AutomationRuleView['mode'], killSwitch = false) {
    setBusy(rule.id)
    try {
      const response = await fetch(`/api/admin/automations/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controlOnly: true, mode, killSwitch }),
      })
      const body = await response.json().catch(() => ({})) as { rule?: AutomationRuleView; error?: string }
      if (!response.ok || !body.rule) throw new Error(body.error ?? 'Automation could not be updated')
      setRules(current => current.map(item => item.id === rule.id ? { ...item, ...body.rule } : item))
      toast.success(killSwitch ? 'Turned off' : mode === 'paused' ? 'Automation paused' : mode === 'dry_run' ? 'Dry-run mode enabled' : 'Automation is live')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Automation could not be updated')
    } finally {
      setBusy(null)
    }
  }

  async function dryRun(rule: AutomationRuleView) {
    setBusy(rule.id)
    try {
      const response = await fetch(`/api/admin/automations/${rule.id}/dry-run`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { proposed?: DryRunCandidate[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Dry run failed')
      const proposed = body.proposed ?? []
      setDryRuns(current => ({ ...current, [rule.id]: proposed }))
      setExpanded(rule.id)
      toast.success(`Dry run complete: ${proposed.reduce((count, candidate) => count + candidate.actionKeys.length, 0)} proposed, 0 executed`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dry run failed')
    } finally {
      setBusy(null)
    }
  }

  async function retry(rule: AutomationRuleView, run: AutomationRunView) {
    setBusy(rule.id)
    try {
      const response = await fetch(`/api/admin/automations/runs/${run.id}/retry`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Retry failed')
      toast.success('Retry completed without duplicating prior actions')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      {(['system_schedule', 'rule_template', 'custom_rule'] as const).map(origin => {
        const group = rules.filter(rule => rule.origin === origin)
        if (!group.length) return null
        const heading = origin === 'system_schedule' ? 'System schedules' : origin === 'rule_template' ? 'Allowlisted templates' : 'Custom allowlisted rules'
        return (
          <section key={origin} aria-labelledby={`automation-${origin}`}>
            <h3 id={`automation-${origin}`} className="mb-3 text-sm font-semibold">{heading}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {group.map(rule => {
                const isBusy = busy === rule.id
                const recentRuns = rule.recentRuns ?? []
                const candidates = dryRuns[rule.id]
                return (
                  <Card key={rule.id} className={rule.kill_switch ? 'border-destructive/50' : ''}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{rule.name}</CardTitle>
                          <CardDescription className="mt-1">{rule.description}</CardDescription>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Badge variant="outline">{origin === 'system_schedule' ? 'System' : origin === 'rule_template' ? 'Template' : 'Custom'}</Badge>
                          <Badge variant={rule.kill_switch ? 'destructive' : statusVariant(rule.mode)} className="capitalize">
                            {rule.kill_switch ? 'stopped' : rule.mode.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm">
                        {describeAutomationSchedule(rule.schedule_cron, rule.schedule_timezone) ?? (rule.schedule_cron ? 'On a schedule' : 'Not on a schedule')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Last success {formatTime(rule.lastSuccess?.finished_at ?? rule.last_success_at)}
                      </p>
                      {rule.lastFailure?.error_summary ? (
                        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {rule.lastFailure.error_summary}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {origin !== 'system_schedule' ? (
                          <Button size="sm" variant="outline" onClick={() => void dryRun(rule)} disabled={isBusy}>
                            {isBusy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Dry run
                          </Button>
                        ) : null}
                        {rule.mode === 'paused' || rule.kill_switch ? (
                          <Button size="sm" onClick={() => void updateControl(rule, origin === 'system_schedule' ? 'live' : 'dry_run')} disabled={isBusy}><Play /> Resume safely</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => void updateControl(rule, 'paused')} disabled={isBusy}><Pause /> Pause</Button>
                        )}
                        {origin !== 'system_schedule' && rule.mode === 'dry_run' && !rule.kill_switch ? (
                          <Button size="sm" onClick={() => void updateControl(rule, 'live')} disabled={isBusy}><Play /> Go live</Button>
                        ) : null}
                        {!rule.kill_switch ? (
                          <Button size="sm" variant="destructive" onClick={() => void updateControl(rule, 'paused', true)} disabled={isBusy}>
                            <ShieldAlert /> Turn off
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" aria-expanded={expanded === rule.id} onClick={() => setExpanded(current => current === rule.id ? null : rule.id)}>
                          {expanded === rule.id ? <ChevronUp /> : <ChevronDown />} History
                        </Button>
                      </div>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Technical details</summary>
                        <div className="mt-2 space-y-2">
                          {rule.schedule_cron ? <p>Schedule: {rule.schedule_cron} {rule.schedule_timezone}</p> : null}
                          {rule.action_key === 'system_job' ? <p>system.job</p> : (
                            <p>Action: {rule.action_key.replaceAll('_', ' ')}</p>
                          )}
                          <p className="flex items-center gap-1.5">
                            <ShieldCheck className="h-3.5 w-3.5" /> {rule.approval_policy === 'required' ? 'Actions wait for approval' : 'Policy permits automatic preparation or internal execution'}
                          </p>
                          <p>Trigger: {rule.trigger_key.replaceAll('_', ' ')}</p>
                          <p>Next expected {formatTime(rule.next_run_at)} · Pending approvals {rule.pendingApprovals ?? 0}</p>
                          <p className={rule.lastFailure ? 'text-destructive' : ''}>Last failure {formatTime(rule.lastFailure?.finished_at ?? rule.last_failure_at)}</p>
                        </div>
                      </details>
                      {expanded === rule.id ? (
                        <div className="space-y-2 border-t pt-3">
                          {candidates ? (
                            <div className="rounded-md bg-muted p-3 text-xs">
                              <strong>Latest dry run: {candidates.length} candidate{candidates.length === 1 ? '' : 's'}, no side effects</strong>
                              {candidates.length ? <ul className="mt-2 space-y-1">{candidates.map(candidate => (
                                <li key={candidate.candidateKey}>{candidate.title} — {candidate.reason} ({candidate.actionKeys.join(', ')})</li>
                              ))}</ul> : <p className="mt-1 text-muted-foreground">Nothing currently matches this trigger.</p>}
                            </div>
                          ) : null}
                          {recentRuns.length ? recentRuns.map(run => (
                            <div key={run.id} className="flex items-start justify-between gap-3 rounded-md border p-2 text-xs">
                              <div>
                                <div className="flex items-center gap-2"><Badge variant={statusVariant(run.status)}>{run.status.replace('_', ' ')}</Badge><span>{formatTime(run.started_at)}</span></div>
                                <p className="mt-1 text-muted-foreground">Attempt {run.attempt ?? 1} · proposed {run.proposed_count ?? 0} · executed {run.executed_count ?? 0}</p>
                                {run.next_retry_at ? <p className="mt-1 text-muted-foreground">Next retry: {formatTime(run.next_retry_at)}</p> : null}
                              </div>
                              {run.status === 'failed' && origin !== 'system_schedule' && (run.attempt ?? 1) < rule.max_attempts ? (
                                <Button size="sm" variant="outline" onClick={() => void retry(rule, run)} disabled={isBusy}><RefreshCw /> Retry</Button>
                              ) : null}
                            </div>
                          )) : <p className="text-xs text-muted-foreground">No runs recorded yet.</p>}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
