'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, RefreshCw, Users, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatPhoneDisplay } from '@/lib/phone'
import { cn } from '@/lib/utils'

interface CandidateMatter {
  id: string
  matter_number: string | null
  name: string | null
  relationship_status: string | null
  relationship_type: string | null
}

interface CandidateSide {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  date_of_birth: string | null
  relationship_type: string | null
  relationship_label: string | null
  created_at: string | null
  matters: CandidateMatter[]
}

interface Candidate {
  winner: CandidateSide
  loser: CandidateSide
  email: string
  namesMatch: boolean
}

function fullName(side: CandidateSide): string {
  return [side.first_name, side.middle_name, side.last_name].filter(Boolean).join(' ').trim()
    || side.preferred_name
    || '(no name)'
}

function Field({ label, value, differs }: { label: string; value: string | null; differs?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate text-right', differs && 'font-medium text-amber-700 dark:text-amber-400')}>
        {value || <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  )
}

/** One side of the comparison. Differing values are highlighted on both. */
function SideCard({
  side,
  other,
  title,
  tone,
}: {
  side: CandidateSide
  other: CandidateSide
  title: string
  tone: 'keep' | 'remove'
}) {
  const differs = (a: string | null, b: string | null) =>
    Boolean((a ?? '').trim() && (b ?? '').trim() && (a ?? '').trim() !== (b ?? '').trim())

  return (
    <section
      className={cn(
        'flex-1 rounded-md border px-3 py-2',
        tone === 'keep' ? 'border-emerald-600/40 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-border',
      )}
    >
      <header className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {side.relationship_type && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {side.relationship_label || side.relationship_type}
          </span>
        )}
      </header>
      <p className="truncate text-sm font-semibold">{fullName(side)}</p>
      <Field label="Email" value={side.email} />
      <Field label="Phone" value={formatPhoneDisplay(side.phone) || side.phone} differs={differs(side.phone, other.phone)} />
      <Field label="Born" value={side.date_of_birth} differs={differs(side.date_of_birth, other.date_of_birth)} />
      <Field label="Location" value={[side.city, side.state].filter(Boolean).join(', ') || null} />
      <Field label="Added" value={side.created_at ? side.created_at.slice(0, 10) : null} />

      <div className="mt-2 border-t border-border pt-2">
        <p className="mb-1 text-xs text-muted-foreground">
          {side.matters.length === 0
            ? 'On no matters'
            : `On ${side.matters.length} matter${side.matters.length === 1 ? '' : 's'}`}
        </p>
        <ul className="space-y-0.5">
          {side.matters.map(matter => (
            <li key={matter.id} className="truncate text-sm">
              <Link href={`/admin/matters/${matter.id}`} className="hover:underline">
                {matter.matter_number || matter.name || matter.id.slice(0, 8)}
              </Link>
              {matter.relationship_type && (
                <span className="ml-1 text-xs text-muted-foreground">({matter.relationship_type})</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function MergeReviewClient() {
  const token = useAccessToken()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [merged, setMerged] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      const res = await fetch('/api/admin/contacts/merge', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load duplicate candidates')
      setCandidates(json.candidates ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load duplicate candidates')
      setCandidates([])
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function merge(candidate: Candidate) {
    if (!token) return
    const key = candidate.loser.id
    setBusyId(key)
    setError(null)
    try {
      const res = await fetch('/api/admin/contacts/merge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerContactId: candidate.winner.id,
          loserContactId: candidate.loser.id,
          reason: `Reviewed duplicate — matching email ${candidate.email}`,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Merge failed')
      setMerged(prev => [
        ...prev,
        `${fullName(candidate.loser)} merged into ${fullName(candidate.winner)} — ` +
          `${json.matterLinksMoved} matter link(s), ${json.rolesMoved} role(s), ` +
          `${json.messagesMoved} message(s), ${json.designSheetsRewritten} design sheet(s) updated.`,
      ])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setBusyId(null)
    }
  }

  const visible = (candidates ?? []).filter(c => !skipped.has(c.loser.id))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Duplicate contacts"
        description="People who share an email address. Nothing is merged until you say so."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {merged.map((line, i) => (
        <p key={i} className="rounded-md border border-emerald-600/40 bg-emerald-50/40 px-3 py-2 text-sm dark:bg-emerald-950/20">
          {line} <span className="text-muted-foreground">Reversible — the removed row is kept, not deleted.</span>
        </p>
      ))}

      {candidates === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {candidates !== null && visible.length === 0 && (
        <EmptyState
          icon={Users}
          title="No duplicates to review"
          description="Nobody shares an email address with anyone else right now."
        />
      )}

      {visible.map(candidate => (
        <article key={candidate.loser.id} className="rounded-lg border border-border bg-card p-3">
          {!candidate.namesMatch && (
            <p className="mb-2 flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Different names on the same email.</strong> This is much more often a couple
                sharing an inbox than one person entered twice. Check before merging.
              </span>
            </p>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
            <SideCard side={candidate.loser} other={candidate.winner} title="Will be removed" tone="remove" />
            <div className="flex items-center justify-center px-1">
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="merged into" />
            </div>
            <SideCard side={candidate.winner} other={candidate.loser} title="Will be kept" tone="keep" />
          </div>

          <footer className="mt-3 flex items-center gap-2">
            <Button
              type="button" size="sm"
              disabled={busyId === candidate.loser.id}
              onClick={() => void merge(candidate)}
            >
              <Check className="h-3.5 w-3.5" />
              {busyId === candidate.loser.id ? 'Merging…' : 'Merge'}
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => setSkipped(prev => new Set(prev).add(candidate.loser.id))}
            >
              <X className="h-3.5 w-3.5" />
              Not a duplicate
            </Button>
            <span className="text-xs text-muted-foreground">
              Moves matters, appointments, messages and design-sheet references onto the kept row.
            </span>
          </footer>
        </article>
      ))}
    </div>
  )
}
