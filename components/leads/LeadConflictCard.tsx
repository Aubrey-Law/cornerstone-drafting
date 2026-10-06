'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  describeConflictCheck,
  KIND_LABELS,
  MATCHED_ON_LABELS,
  type ConflictCheckState,
} from '@/lib/conflicts/match'
import { TONE_BADGE, type Tone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

/**
 * The conflict check on a lead: what the search found in the firm's records
 * and the attorney's decision about it. The search runs when the lead is
 * created; this card shows it, re-runs it after the record has changed (a
 * spouse added, an email corrected), and records "no conflict" or "conflict".
 * A recorded conflict stops the lead being hired until it is cleared.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function tone(state: ConflictCheckState | null): Tone {
  if (!state) return 'neutral'
  if (state.decision === 'conflict') return 'danger'
  if (state.decision === 'no_conflict') return 'success'
  return state.result === 'clear' ? 'success' : 'warning'
}

export function LeadConflictCard({
  leadId,
  initialCheck,
  canDecide = true,
  onChange,
}: {
  leadId: string
  initialCheck: ConflictCheckState | null
  canDecide?: boolean
  /** Called with the new state after a run or a decision, so the brief can re-evaluate. */
  onChange?: (state: ConflictCheckState | null) => void
}) {
  const [check, setCheck] = useState(initialCheck)
  const [busy, setBusy] = useState<'run' | 'decide' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<'conflict' | null>(null)
  const [note, setNote] = useState('')

  async function request(init: RequestInit): Promise<ConflictCheckState | null> {
    const { supabase } = await import('@/lib/supabaseClient')
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch(`/api/admin/leads/${encodeURIComponent(leadId)}/conflict-check`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    const body = await response.json().catch(() => ({})) as { check?: ConflictCheckState | null; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Request failed')
    return body.check ?? null
  }

  async function run() {
    setBusy('run')
    setError(null)
    try {
      const next = await request({ method: 'POST' })
      setCheck(next)
      onChange?.(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not run the check')
    } finally {
      setBusy(null)
    }
  }

  async function decide(decision: 'no_conflict' | 'conflict') {
    if (!check) return
    setBusy('decide')
    setError(null)
    try {
      const next = await request({ method: 'PATCH', body: JSON.stringify({ checkId: check.id, decision, note: note.trim() || null }) })
      setCheck(next)
      setDeciding(null)
      setNote('')
      onChange?.(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record the decision')
    } finally {
      setBusy(null)
    }
  }

  const pending = check?.result === 'possible' && check.decision === 'pending'

  return (
    <section aria-label="Conflict check" className="rounded-lg border border-border bg-card p-4" data-testid="lead-conflict-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            {check?.decision === 'conflict'
              ? <ShieldAlert className="size-4 text-destructive" aria-hidden />
              : pending
                ? <AlertTriangle className="size-4" aria-hidden />
                : <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />}
            Conflict check
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {describeConflictCheck(check)}
            {check ? ` Checked ${DATE.format(new Date(check.checkedAt))}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-micro', TONE_BADGE[tone(check)])}>
            {!check ? 'Not run' : check.decision === 'conflict' ? 'Conflict' : check.decision === 'no_conflict' ? 'Clear' : 'Needs review'}
          </Badge>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void run()}>
            {busy === 'run' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {check ? 'Run again' : 'Run check'}
          </Button>
        </div>
      </div>

      {check && check.hits.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60 rounded-md border border-border">
          {check.hits.map(hit => (
            <li key={`${hit.kind}:${hit.id}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm">
                  <Link href={hit.href} className="font-medium underline-offset-2 hover:underline">{hit.label}</Link>
                  <span className="text-muted-foreground"> · {KIND_LABELS[hit.kind]}</span>
                </p>
                <p className="text-xs text-muted-foreground">{hit.context}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className={cn('font-medium', hit.strength === 'strong' ? 'text-foreground' : '')}>
                  {hit.strength === 'strong' ? 'Strong' : 'Possible'}
                </span>
                {' · '}{hit.matchedOn.map(reason => MATCHED_ON_LABELS[reason]).join(', ')}
                {hit.matchedValue ? ` (${hit.matchedValue})` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {check?.note && (
        <p className="mt-2 text-xs text-muted-foreground">Note: {check.note}</p>
      )}

      {canDecide && check && check.result === 'possible' && check.decision !== 'conflict' && (
        <div className="mt-3 space-y-2">
          {deciding === 'conflict' && (
            <Textarea
              aria-label="Conflict note"
              rows={2}
              placeholder="What the conflict is, for the file (optional)"
              value={note}
              onChange={event => setNote(event.target.value)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {check.decision === 'pending' && (
              <Button type="button" size="sm" disabled={busy !== null} onClick={() => void decide('no_conflict')}>
                {busy === 'decide' && deciding !== 'conflict' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                No conflict
              </Button>
            )}
            {deciding === 'conflict' ? (
              <>
                <Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={() => void decide('conflict')}>
                  Record conflict
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDeciding(null)}>Cancel</Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setDeciding('conflict')}>
                Conflict
              </Button>
            )}
          </div>
        </div>
      )}

      {canDecide && check?.decision === 'conflict' && (
        <div className="mt-3">
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide('no_conflict')}>
            Clear the conflict
          </Button>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}
