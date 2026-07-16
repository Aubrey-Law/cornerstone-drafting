'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type { EstateClauseOverrideAction, EstateDocumentType } from '@/lib/estateClauses/types'

type OverrideDto = {
  id: string
  action: EstateClauseOverrideAction
  reason: string
  actorId: string
}

type EligibleClause = {
  clauseKey: string
  title: string
  documentTypes: EstateDocumentType[]
  conditionField: string
  currentRevisionId: string
  revisionNumber: number
  defaultOutcome: 'include' | 'omit' | 'mixed'
  override: OverrideDto | null
}

type OverrideListResponse = {
  matterId: string
  clauses: EligibleClause[]
  staleOverrides: Array<OverrideDto & { clauseId: string; clauseKey: string; title: string }>
}

type DraftOverride = { action: EstateClauseOverrideAction | ''; reason: string }

function draftFor(clause: EligibleClause): DraftOverride {
  return {
    action: clause.override?.action ?? '',
    reason: clause.override?.reason ?? '',
  }
}

export function ClauseOverridesPanel({ matterId, onMutated }: { matterId: string; onMutated: () => void }) {
  const accessToken = useAccessToken()
  const [data, setData] = useState<OverrideListResponse | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftOverride>>({})
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/estate-clause-overrides`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const next = await response.json().catch(() => ({})) as OverrideListResponse & { error?: string }
      if (!response.ok) throw new Error(next.error ?? 'Unable to load clause overrides.')
      next.staleOverrides ??= []
      setData(next)
      setDrafts(Object.fromEntries(next.clauses.map(clause => [clause.clauseKey, draftFor(clause)])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load clause overrides.')
    } finally {
      setLoading(false)
    }
  }, [accessToken, matterId])

  useEffect(() => { void load() }, [load])

  const mutate = async (clause: Pick<EligibleClause, 'clauseKey' | 'title'>, method: 'PUT' | 'DELETE') => {
    if (!accessToken) return
    const eligibleClause = data?.clauses.find(item => item.clauseKey === clause.clauseKey)
    const draft = drafts[clause.clauseKey] ?? (eligibleClause ? draftFor(eligibleClause) : { action: '', reason: '' })
    setBusyKey(clause.clauseKey)
    setError(null)
    try {
      const body = method === 'DELETE'
        ? { clauseKey: clause.clauseKey }
        : { clauseKey: clause.clauseKey, action: draft.action, reason: draft.reason.trim() }
      const response = await fetch(`/api/admin/matters/${matterId}/estate-clause-overrides`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Unable to update the clause override.')
      onMutated()
      toast.success(method === 'DELETE' ? 'Clause override removed.' : 'Clause override saved. Preflight must be run again.')
      await load()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Unable to update the clause override.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="clause-overrides-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 id="clause-overrides-title" className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Clause overrides
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Attorney exceptions apply only to conditional clauses in the selected current templates.
          </p>
        </div>
        {data && <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">{data.clauses.length} eligible</span>}
      </div>

      {error && (
        <div className="m-4 flex gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading eligible clauses…
        </div>
      ) : data && (data.clauses.length > 0 || data.staleOverrides.length > 0) ? (
        <div>
          <div className="divide-y divide-border">
            {data.clauses.map(clause => {
            const draft = drafts[clause.clauseKey] ?? draftFor(clause)
            const busy = busyKey === clause.clauseKey
            const canSave = Boolean(draft.action) && draft.reason.trim().length >= 10 && !busy
            return (
              <div key={clause.clauseKey} className="grid gap-3 p-4 lg:grid-cols-[minmax(220px,1fr)_200px_minmax(260px,1.4fr)_auto] lg:items-end">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{clause.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{clause.clauseKey}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-muted px-2 py-1">Default: {clause.defaultOutcome}</span>
                    <span className="rounded bg-muted px-2 py-1">Published revision {clause.revisionNumber}</span>
                  </div>
                </div>
                <label className="grid gap-1 text-xs font-medium">
                  Override action
                  <select
                    aria-label={`Override action for ${clause.title}`}
                    value={draft.action}
                    disabled={busy}
                    onChange={event => setDrafts(current => ({
                      ...current,
                      [clause.clauseKey]: { ...draft, action: event.target.value as EstateClauseOverrideAction | '' },
                    }))}
                    className="h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Use template default</option>
                    <option value="force_include">Force include</option>
                    <option value="force_omit">Force omit</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-medium">
                  Reason <span className="font-normal text-muted-foreground">(minimum 10 characters)</span>
                  <input
                    aria-label={`Reason for ${clause.title}`}
                    value={draft.reason}
                    disabled={busy}
                    onChange={event => setDrafts(current => ({
                      ...current,
                      [clause.clauseKey]: { ...draft, reason: event.target.value },
                    }))}
                    className="h-9 rounded-md border border-input bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Record the attorney's matter-specific reason"
                  />
                </label>
                <div className="flex gap-2 lg:justify-end">
                  {clause.override && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void mutate(clause, 'DELETE')}
                      aria-label={`Remove ${clause.title} override`}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Default
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSave}
                    onClick={() => void mutate(clause, 'PUT')}
                    aria-label={`Save ${clause.title} override`}
                  >
                    {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            )
            })}
          </div>
          {data.staleOverrides.length > 0 && (
            <div className="border-t border-warning/30 bg-warning/5 p-4">
              <div className="mb-3 flex items-start gap-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Cleanup required</p>
                  <p className="mt-0.5">These saved overrides no longer target a current eligible clause. Remove them before generation.</p>
                </div>
              </div>
              <div className="space-y-2">
                {data.staleOverrides.map(override => (
                  <div key={override.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-background px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{override.title}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{override.clauseKey}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyKey === override.clauseKey}
                      onClick={() => void mutate(override, 'DELETE')}
                      aria-label={`Remove stale ${override.title} override`}
                    >
                      {busyKey === override.clauseKey
                        ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          No current conditional clauses are referenced by the templates selected for this matter.
        </p>
      )}
    </section>
  )
}
