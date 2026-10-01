'use client'

import { useState } from 'react'
import { FlaskConical, Loader2, Pause, Play, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  lastRun?: { status?: string; started_at?: string; error_summary?: string | null } | null
}

export function AutomationsClient({ initialRules }: { initialRules: AutomationRuleView[] }) {
  const [rules, setRules] = useState(initialRules)
  const [busy, setBusy] = useState<string | null>(null)

  async function update(rule: AutomationRuleView, mode: AutomationRuleView['mode']) {
    setBusy(rule.id)
    try {
      const response = await fetch(`/api/admin/automations/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rule.name,
          description: rule.description,
          triggerKey: rule.trigger_key,
          actionKey: rule.action_key,
          conditions: rule.conditions,
          actionConfig: rule.action_config,
          mode,
          approvalPolicy: rule.approval_policy,
        }),
      })
      const body = await response.json().catch(() => ({})) as { rule?: AutomationRuleView; error?: string }
      if (!response.ok || !body.rule) throw new Error(body.error ?? 'Automation could not be updated')
      setRules(current => current.map(item => item.id === rule.id ? { ...item, ...body.rule } : item))
      toast.success(mode === 'paused' ? 'Automation paused' : mode === 'dry_run' ? 'Dry-run mode enabled' : 'Automation enabled')
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
      const body = await response.json().catch(() => ({})) as { proposed?: unknown[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Dry run failed')
      toast.success(`Dry run complete: ${body.proposed?.length ?? 0} action proposed, 0 executed`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dry run failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rules.map(rule => (
        <Card key={rule.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{rule.name}</CardTitle>
                <CardDescription className="mt-1">{rule.description}</CardDescription>
              </div>
              <Badge variant={rule.mode === 'live' ? 'default' : 'outline'} className="capitalize">
                {rule.mode.replace('_', ' ')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted p-2"><span className="block text-muted-foreground">Trigger</span>{rule.trigger_key.replaceAll('_', ' ')}</div>
              <div className="rounded-md bg-muted p-2"><span className="block text-muted-foreground">Action</span>{rule.action_key.replaceAll('_', ' ')}</div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> {rule.approval_policy === 'required' ? 'Requires approval before execution' : 'Internal preparation may run automatically'}
            </p>
            <div className="rounded-md border px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">Last run: </span>
              {rule.lastRun?.status ? (
                <span className={rule.lastRun.status === 'failed' ? 'text-destructive' : 'text-foreground'}>
                  {rule.lastRun.status.replace('_', ' ')}
                  {rule.lastRun.started_at ? ` · ${new Date(rule.lastRun.started_at).toLocaleString()}` : ''}
                  {rule.lastRun.error_summary ? ` · ${rule.lastRun.error_summary}` : ''}
                </span>
              ) : <span className="text-muted-foreground">Never</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => dryRun(rule)} disabled={busy === rule.id}>
                {busy === rule.id ? <Loader2 className="animate-spin" /> : <FlaskConical />} Dry run
              </Button>
              {rule.mode === 'paused' ? (
                <Button size="sm" onClick={() => update(rule, 'dry_run')} disabled={busy === rule.id}><Play /> Enable safely</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => update(rule, 'paused')} disabled={busy === rule.id}><Pause /> Pause</Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
