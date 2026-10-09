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
      <span className={cn('min-w-0 truncate text-right', differs && 'font-medium text-amber')}>
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
        tone === 'keep' ? 'border-green/40 bg-green-bg' : 'border-border',
      )}
    >
      <header className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {side.relationship_type && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-micro text-muted-foreground">
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

interface CandidateGroup {
  winner: CandidateSide
  email: string
  copies: Candidate[]
}

/**
 * The view pairs every copy with the one row its email would keep, so grouping
 * by that row turns "Ann entered 108 times" into one card instead of a hundred.
 */
function groupCandidates(candidates: Candidate[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.winner.id)
    if (group) group.copies.push(candidate)
    else groups.set(candidate.winner.id, { winner: candidate.winner, email: candidate.email, copies: [candidate] })
  }
  return [...groups.values()].sort((a, b) => b.copies.length - a.copies.length)
}

/** How many copies of a group to show before "Show all". */
const COLLAPSED_COPIES = 3

export function MergeReviewClient() {
  const token = useAccessToken()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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

  /** Merge one or more reviewed copies into the row the group keeps. */
  async function merge(winner: CandidateSide, copies: Candidate[], busyKey: string) {
    if (!token || copies.length === 0) return
    setBusyId(busyKey)
    setError(null)
    try {
      const res = await fetch('/api/admin/contacts/merge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerContactId: winner.id,
          loserContactIds: copies.map(copy => copy.loser.id),
          reason: `Reviewed duplicate — matching email ${copies[0].email}`,
        }),
      })
      const json = await res.json()
      const summary = (count: number) =>
        `${count} cop${count === 1 ? 'y' : 'ies'} merged into ${fullName(winner)} — ` +
        `${json.matterLinksMoved ?? 0} matter link(s), ${json.rolesMoved ?? 0} role(s), ` +
        `${json.messagesMoved ?? 0} message(s), ${json.designSheetsRewritten ?? 0} design sheet(s) updated.`
      if (json.merged > 0) setMerged(prev => [...prev, summary(json.merged)])
      if (!res.ok) throw new Error(json.error ?? 'Merge failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const groups = groupCandidates((candidates ?? []).filter(c => !skipped.has(c.loser.id)))

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
        <p key={i} className="rounded-md border border-green/40 bg-green-bg px-3 py-2 text-sm">
          {line} <span className="text-muted-foreground">Reversible — the removed row is kept, not deleted.</span>
        </p>
      ))}

      {candidates === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {candidates !== null && groups.length === 0 && (
        <EmptyState
          icon={Users}
          title="No duplicates to review"
          description="Nobody shares an email address with anyone else right now."
        />
      )}

      {groups.map(group => {
        const sameName = group.copies.filter(c => c.namesMatch)
        const isExpanded = expanded.has(group.winner.id)
        const shown = isExpanded ? group.copies : group.copies.slice(0, COLLAPSED_COPIES)
        const groupBusy = busyId === group.winner.id

        return (
          <article key={group.winner.id} className="space-y-3 rounded-lg border border-border bg-card p-3">
            <header className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{group.email}</p>
              <span className="text-xs text-muted-foreground">
                {group.copies.length + 1} rows share this email
              </span>
              {sameName.length > 1 && (
                <Button
                  type="button" size="sm" className="ml-auto"
                  disabled={busyId !== null}
                  onClick={() => {
                    if (!window.confirm(
                      `Merge ${sameName.length} copies named ${fullName(group.winner)} into the kept row? ` +
                      'Copies with a different name are left for you to review one by one.',
                    )) return
                    void merge(group.winner, sameName, group.winner.id)
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  {groupBusy ? 'Merging…' : `Merge all ${sameName.length} with the same name`}
                </Button>
              )}
            </header>

            {shown.map(candidate => (
              <div key={candidate.loser.id} className="rounded-md border border-border p-2">
                {!candidate.namesMatch && (
                  <p className="mb-2 flex items-start gap-2 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
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

                <footer className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button" size="sm"
                    disabled={busyId !== null}
                    onClick={() => void merge(candidate.winner, [candidate], candidate.loser.id)}
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
              </div>
            ))}

            {group.copies.length > COLLAPSED_COPIES && (
              <Button
                type="button" size="sm" variant="ghost"
                onClick={() => setExpanded(prev => {
                  const next = new Set(prev)
                  if (next.has(group.winner.id)) next.delete(group.winner.id)
                  else next.add(group.winner.id)
                  return next
                })}
              >
                {isExpanded ? 'Show fewer' : `Show all ${group.copies.length} copies`}
              </Button>
            )}
          </article>
        )
      })}
    </div>
  )
}
