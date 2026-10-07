'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  ANCHOR_LABELS,
  CONDITION_LABELS,
  DEADLINE_ANCHORS,
  DEADLINE_CONDITIONS,
  DEADLINE_TARGET_FIELDS,
  TARGET_FIELD_LABELS,
  ruleSummary,
  type DeadlineRule,
  type DeadlineRulePatch,
} from '@/lib/probateDeadlines/model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatFirmDate } from '@/lib/format'

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'

/**
 * Probate deadlines: the rules that date every probate matter. Each rule is
 * the attorney's; a draft computes nothing until it is confirmed, and a change
 * to when it falls sends it back to draft.
 */
export function ProbateDeadlinesSettingsSection({ isAdministrator }: { isAdministrator: boolean }) {
  const token = useAccessToken()
  const [rules, setRules] = useState<DeadlineRule[]>([])
  const [drafts, setDrafts] = useState<Record<string, DeadlineRule>>({})
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const headers = useCallback((json = false) => ({
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }), [token])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/probate-deadlines', { headers: headers() })
      const body = await res.json().catch(() => ({})) as { rules?: DeadlineRule[]; unavailable?: boolean; error?: string }
      if (!res.ok || !body.rules) throw new Error(body.error ?? 'Failed to load probate deadlines')
      setRules(body.rules)
      setDrafts(Object.fromEntries(body.rules.map(rule => [rule.key, rule])))
      setUnavailable(body.unavailable === true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load probate deadlines')
    } finally {
      setLoading(false)
    }
  }, [headers, token])

  useEffect(() => { void load() }, [load])

  function edit(key: string, change: Partial<DeadlineRule>) {
    setDrafts(current => ({ ...current, [key]: { ...current[key], ...change } }))
  }

  async function save(rule: DeadlineRule, confirm?: boolean) {
    if (!token) return
    const draft = drafts[rule.key] ?? rule
    const patch: DeadlineRulePatch = {
      key: rule.key,
      title: draft.title,
      anchor: draft.anchor,
      offsetMonths: draft.offsetMonths,
      offsetDays: draft.offsetDays,
      appliesWhen: draft.appliesWhen,
      rollWeekend: draft.rollWeekend,
      targetField: draft.targetField,
      citation: draft.citation,
      active: draft.active,
      ...(confirm === undefined ? {} : { confirm }),
    }
    setBusyKey(rule.key)
    try {
      const res = await fetch('/api/admin/settings/probate-deadlines', { method: 'PATCH', headers: headers(true), body: JSON.stringify(patch) })
      const body = await res.json().catch(() => ({})) as { rule?: DeadlineRule; sync?: { matters: number; created: number; redated: number }; error?: string }
      if (!res.ok || !body.rule) throw new Error(body.error ?? 'Could not save the rule')
      const sync = body.sync
      toast.success(body.rule.confirmedAt
        ? `Saved. ${sync ? `${sync.matters} probate ${sync.matters === 1 ? 'matter' : 'matters'} checked, ${sync.created} new ${sync.created === 1 ? 'task' : 'tasks'}.` : ''}`
        : 'Saved as a draft. It computes nothing until it is confirmed.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the rule')
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (unavailable) return <p className="text-sm text-muted-foreground">Probate deadlines arrive with the next database update.</p>

  return (
    <div className="space-y-4" data-testid="probate-deadlines-settings">
      <div>
        <h2 className="text-base font-semibold">Probate deadlines</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each rule dates every probate matter from a fact on the record and adds a task for it. A rule is yours: a draft
          computes nothing until you check its period against the authority and confirm it, and changing when it falls
          sends it back to draft.
        </p>
      </div>
      {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
      {rules.map(rule => {
        const draft = drafts[rule.key] ?? rule
        const busy = busyKey === rule.key
        const disabled = !isAdministrator || busy
        return (
          <section key={rule.key} className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid={`deadline-rule-${rule.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{rule.title}</p>
                <p className="text-xs text-muted-foreground">{ruleSummary(rule)} · {CONDITION_LABELS[rule.appliesWhen]}</p>
              </div>
              {rule.confirmedAt
                ? <Badge variant="secondary">Confirmed {formatFirmDate(rule.confirmedAt)}</Badge>
                : <Badge variant="outline">Draft, not in use</Badge>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Counted from</span>
                <select className={selectClass} value={draft.anchor} disabled={disabled} onChange={event => edit(rule.key, { anchor: event.target.value as DeadlineRule['anchor'] })}>
                  {DEADLINE_ANCHORS.map(anchor => <option key={anchor} value={anchor}>{ANCHOR_LABELS[anchor]}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">Months after</span>
                  <Input type="number" min={0} max={120} className="h-9" value={draft.offsetMonths} disabled={disabled}
                    onChange={event => edit(rule.key, { offsetMonths: Number(event.target.value) || 0 })} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">Plus days</span>
                  <Input type="number" className="h-9" value={draft.offsetDays} disabled={disabled}
                    onChange={event => edit(rule.key, { offsetDays: Number(event.target.value) || 0 })} />
                </label>
              </div>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Applies to</span>
                <select className={selectClass} value={draft.appliesWhen} disabled={disabled} onChange={event => edit(rule.key, { appliesWhen: event.target.value as DeadlineRule['appliesWhen'] })}>
                  {DEADLINE_CONDITIONS.map(condition => <option key={condition} value={condition}>{CONDITION_LABELS[condition]}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Fills the matter’s date</span>
                <select className={selectClass} value={draft.targetField ?? ''} disabled={disabled}
                  onChange={event => edit(rule.key, { targetField: (event.target.value || null) as DeadlineRule['targetField'] })}>
                  <option value="">None, task only</option>
                  {DEADLINE_TARGET_FIELDS.map(field => <option key={field} value={field}>{TARGET_FIELD_LABELS[field]}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Authority</span>
                <Input className="h-9" value={draft.citation ?? ''} disabled={disabled} maxLength={1000}
                  onChange={event => edit(rule.key, { citation: event.target.value })} />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <Switch checked={draft.rollWeekend} disabled={disabled} onCheckedChange={checked => edit(rule.key, { rollWeekend: checked })} />
                  Move a weekend date to Monday
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={draft.active} disabled={disabled} onCheckedChange={checked => edit(rule.key, { active: checked })} />
                  In use
                </label>
              </div>
              {isAdministrator && (
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(rule)}>Save</Button>
                  {rule.confirmedAt
                    ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(rule, false)}>Return to draft</Button>
                    : (
                      <Button type="button" size="sm" disabled={busy} className="gap-1.5" onClick={() => void save(rule, true)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        I have checked this period. Confirm
                      </Button>
                    )}
                </div>
              )}
            </div>
          </section>
        )
      })}
      {!isAdministrator && <p className="text-xs text-muted-foreground">Only an administrator can change or confirm a rule.</p>}
    </div>
  )
}
