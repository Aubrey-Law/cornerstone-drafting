'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MatterFiduciaryView } from '@/lib/fiduciary/view'
import { TONE_NOTICE, type Tone } from '@/lib/ui/tone'

const SEVERITY_TONE: Record<MatterFiduciaryView['issues'][number]['severity'], Tone> = {
  error: 'danger',
  gap: 'warning',
  note: 'neutral',
}

const SEVERITY_LABEL: Record<MatterFiduciaryView['issues'][number]['severity'], string> = {
  error: 'Contradiction. ',
  gap: 'Gap. ',
  note: 'Worth knowing. ',
}

/**
 * The fiduciary check: who holds which office across every document at once,
 * and what is missing — an office with no successor, minor children with no
 * guardian, one person named twice in a chain.
 *
 * Read from the appointments recorded on this matter's people, the rows the
 * fiduciary check's tasks are opened from, so a gap here is the gap on the
 * Tasks tab. The card above it mirrors the design sheet's slots; the two
 * disagreeing is itself worth noticing.
 */
export function MatterFiduciaryMatrixCard({ matterId }: { matterId: string }) {
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

  return (
    <Card data-testid="fiduciary-matrix">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Fiduciary check</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Link href="/admin/fiduciaries" className="text-xs font-medium text-primary hover:underline">
            All matters
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : view === null ? (
          <p className="text-sm text-muted-foreground">Loading the fiduciary check…</p>
        ) : view.chains.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No appointments are recorded on this matter&apos;s people yet. Add a fiduciary, or give someone in the
            household a role, and the check runs on it.
          </p>
        ) : (
          <>
            {view.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="fiduciary-no-issues">
                Every office has a successor, and nothing contradicts.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="fiduciary-issues">
                {view.issues.map(issue => (
                  <li key={issue.message} className={TONE_NOTICE[SEVERITY_TONE[issue.severity]]}>
                    <span className="font-medium">{SEVERITY_LABEL[issue.severity]}</span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Each person, and what they hold</p>
              <ul className="divide-y divide-border border-y border-border">
                {view.people.map(person => (
                  <li
                    key={person.name + person.offices.join()}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                  >
                    <span className="text-sm font-medium">{person.name}</span>
                    <span className="text-xs text-muted-foreground">{person.offices.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Each office, in order of service
              </summary>
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {view.chains.map(chain => (
                  <li key={`${chain.role}:${chain.forParty}`} className="py-2">
                    <p className="text-sm font-medium">
                      {chain.role}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">for the {chain.forParty}</span>
                    </p>
                    <ol className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {chain.people.map((person, index) => (
                        <li key={`${person.name}:${index}`}>
                          {index + 1}. {person.name}
                          {person.isCoagent ? ' (co-agent)' : ''}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          From the roles recorded on this matter&apos;s people — the same appointments the fiduciary check opens tasks
          from.
        </p>
      </CardContent>
    </Card>
  )
}
