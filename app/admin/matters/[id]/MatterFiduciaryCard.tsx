'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { compareOffices, type OfficeAgreement } from '@/lib/fiduciary/compare'
import type { MatterFiduciaryView } from '@/lib/fiduciary/view'
import type { MatterPlanMirror } from '@/lib/matter/planMirror'
import { TONE_BADGE, TONE_NOTICE, type Tone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

type Severity = MatterFiduciaryView['issues'][number]['severity']

const SEVERITY_TONE: Record<Severity, Tone> = {
  error: 'danger',
  gap: 'warning',
  note: 'neutral',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Contradiction. ',
  gap: 'Gap. ',
  note: 'Worth knowing. ',
}

const AGREEMENT_BADGE: Partial<Record<OfficeAgreement, { label: string; tone: Tone }>> = {
  differs: { label: 'Differs', tone: 'warning' },
  sheet_only: { label: 'Only on the design sheet', tone: 'neutral' },
  people_only: { label: 'Only on people', tone: 'neutral' },
}

interface MatterFiduciaryCardProps {
  matterId: string
  planMirror: MatterPlanMirror
}

/**
 * The matter's fiduciaries, from both places they are kept, side by side:
 *
 * - the design sheet's slots, which the documents are drafted from (read-only
 *   here — the sheet owns them), and
 * - the roles recorded on the matter's people, which the fiduciary check reads
 *   and opens tasks from: an office with no successor, minor children with no
 *   guardian, one person named twice in a chain.
 *
 * The two disagreeing is itself worth noticing, so each office says whether
 * they do.
 */
export function MatterFiduciaryCard({ matterId, planMirror }: MatterFiduciaryCardProps) {
  const designHref = `/admin/drafting/${matterId}?step=design`
  const [view, setView] = useState<MatterFiduciaryView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setView(null)
    setError(null)
    fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/fiduciaries`)
      .then(async response => {
        const body = (await response.json().catch(() => ({}))) as { fiduciaries?: MatterFiduciaryView; error?: string }
        if (!response.ok || !body.fiduciaries) {
          throw new Error(body.error ?? `Could not load the fiduciary check (${response.status})`)
        }
        if (current) setView(body.fiduciaries)
      })
      .catch(err => {
        if (current) setError(err instanceof Error ? err.message : 'Could not load the fiduciary check')
      })
    return () => {
      current = false
    }
  }, [matterId])

  const offices = compareOffices(planMirror.fiduciaries, view?.chains ?? [])
  const shown = offices.filter(office => office.sheetPrimary || office.sheetSuccessor || (office.recorded?.length ?? 0) > 0)
  const differing = view ? offices.filter(office => office.agreement === 'differs').length : 0

  return (
    <Card data-testid="fiduciary-card">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Fiduciaries</CardTitle>
        <CardDescription className="text-xs">
          Who the design sheet appoints, beside the roles recorded on this matter&apos;s people. The fiduciary
          check compares the two.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href={designHref}>Edit on the design sheet</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : view === null ? (
          <p className="text-sm text-muted-foreground">Loading the fiduciary check…</p>
        ) : view.chains.length === 0 && shown.length === 0 ? null : view.chains.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No appointments are recorded on this matter&apos;s people yet. Add a fiduciary, or give someone in the
            household a role, and the check runs on it.
          </p>
        ) : view.issues.length === 0 && differing === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="fiduciary-no-issues">
            Every office has a successor, and nothing contradicts.
          </p>
        ) : view.issues.length > 0 ? (
          <ul className="space-y-2" data-testid="fiduciary-issues">
            {view.issues.map(issue => (
              <li key={issue.message} className={TONE_NOTICE[SEVERITY_TONE[issue.severity]]}>
                <span className="font-medium">{SEVERITY_LABEL[issue.severity]}</span>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {/* With nothing on the sheet and nothing recorded, this one line says
                it all; the "no appointments recorded" note above stays out of
                the way rather than saying the same thing twice. */}
            No fiduciaries named yet.{' '}
            <Link href={designHref} className="font-medium text-primary hover:underline">
              Open the design sheet
            </Link>{' '}
            to appoint them, or add one under Additional contacts.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm" data-testid="fiduciary-offices">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Office</th>
                  <th className="px-3 py-2 font-medium">Design sheet</th>
                  <th className="px-3 py-2 font-medium">Recorded on people</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map(office => {
                  const badge = view ? AGREEMENT_BADGE[office.agreement] : undefined
                  return (
                    <tr key={office.key} className="align-top">
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">{office.role}</span>
                        {badge ? (
                          <Badge variant="outline" className={cn('mt-1 flex text-micro', TONE_BADGE[badge.tone])}>
                            {badge.label}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{office.sheetPrimary ?? '—'}</span>
                        <span className="block text-xs text-muted-foreground">
                          Successor: {office.sheetSuccessor ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {office.recorded === null ? (
                          'Not tracked by the check'
                        ) : office.recorded.length === 0 ? (
                          '—'
                        ) : (
                          <ol className="space-y-0.5">
                            {office.recorded.map((name, index) => (
                              <li key={`${name}:${index}`} className={index === 0 ? 'text-sm font-medium text-foreground' : undefined}>
                                {index + 1}. {name}
                              </li>
                            ))}
                          </ol>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {view && view.people.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Each person, and what they hold
            </summary>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {view.people.map(person => (
                <li
                  key={person.name + person.offices.join()}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
                >
                  <span className="text-sm font-medium">{person.name}</span>
                  <span className="text-xs text-muted-foreground">{person.offices.join(', ')}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}
