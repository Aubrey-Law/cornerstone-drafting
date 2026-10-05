'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  ACTION_AUTONOMY_LEVELS,
  ACTION_CATALOG_GROUPS,
  AUTONOMY_LABELS,
  compareAutonomy,
  type ActionCatalogGroup,
} from '@/lib/actions/autonomy'
import type { DelegationSetting } from '@/lib/actions/delegation'
import type { ActionAutonomy } from '@/lib/actions/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const RISK_LABELS: Record<string, string> = {
  prepare: 'Prepares only',
  internal_write: 'Internal record',
  external_write: 'Leaves the firm',
  legal_financial: 'Legal judgment',
}

/**
 * The delegation dial. One row per registry action, four positions each. A
 * position past the action's ceiling is shown but cannot be chosen, so the
 * limit is visible rather than silently applied.
 */
export function DelegationSettingsSection({ isAdministrator }: { isAdministrator: boolean }) {
  const token = useAccessToken()
  const [rows, setRows] = useState<DelegationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/delegation', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({})) as { actions?: DelegationSetting[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Failed to load delegation settings')
      setRows(body.actions ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load delegation settings')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function setLevel(row: DelegationSetting, autonomy: ActionAutonomy) {
    if (!token || row.autonomy === autonomy) return
    setSavingKey(row.key)
    const previous = rows
    setRows(current => current.map(item => item.key === row.key ? { ...item, autonomy } : item))
    try {
      const res = await fetch('/api/admin/settings/delegation', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionKey: row.key, autonomy }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not save')
      toast.success(`${row.label}: ${AUTONOMY_LABELS[autonomy].label.toLowerCase()}`)
    } catch (error) {
      setRows(previous)
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setSavingKey(null)
    }
  }

  const groups = (Object.keys(ACTION_CATALOG_GROUPS) as ActionCatalogGroup[])
    .map(group => ({ group, label: ACTION_CATALOG_GROUPS[group], rows: rows.filter(row => row.group === group) }))
    .filter(entry => entry.rows.length > 0)

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Each position says how far Cornerstone may take an action when no one is watching: a rule
          that fires, a reminder that comes due, a reply the assistant prepared overnight. Your own
          clicks are never changed by this page.
        </p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {ACTION_AUTONOMY_LEVELS.map(level => (
            <div key={level} className="flex gap-2">
              <dt className="shrink-0 font-medium text-foreground">{AUTONOMY_LABELS[level].label}.</dt>
              <dd>{AUTONOMY_LABELS[level].description}</dd>
            </div>
          ))}
        </dl>
        <p>
          Some positions are closed by the action&apos;s risk: legal judgment never passes
          &ldquo;Propose&rdquo;, and anything that leaves the firm is always reported.
          {isAdministrator ? '' : ' Changing a position requires the administrator role.'}
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>
      ) : groups.map(entry => (
        <section key={entry.group} className="space-y-2">
          <h3 className="text-sm font-semibold">{entry.label}</h3>
          <ul className="divide-y rounded-lg border">
            {entry.rows.map(row => (
              <li key={row.key} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.label}</span>
                    <Badge variant="outline">{RISK_LABELS[row.risk] ?? row.risk.replace('_', ' ')}</Badge>
                    {row.undoable ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><RotateCcw className="h-3 w-3" aria-hidden /> undo available</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
                </div>
                <div role="radiogroup" aria-label={`${row.label} delegation`} className="flex shrink-0 overflow-hidden rounded-md border text-xs">
                  {ACTION_AUTONOMY_LEVELS.map(level => {
                    const closed = compareAutonomy(level, row.ceiling) > 0
                    const active = row.autonomy === level
                    const disabled = closed || !isAdministrator || savingKey === row.key
                    return (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={disabled}
                        title={closed ? `Not available for ${RISK_LABELS[row.risk]?.toLowerCase() ?? row.risk}` : AUTONOMY_LABELS[level].description}
                        onClick={() => void setLevel(row, level)}
                        className={cn(
                          'px-2.5 py-1.5 transition-colors first:rounded-l-md last:rounded-r-md',
                          active ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
                          closed && 'cursor-not-allowed opacity-40 line-through',
                          !closed && disabled && 'opacity-60',
                        )}
                      >
                        {AUTONOMY_LABELS[level].label}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
