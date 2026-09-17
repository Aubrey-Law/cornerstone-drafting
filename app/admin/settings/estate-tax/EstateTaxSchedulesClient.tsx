'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  FederalEstateTaxSchedule,
  MassachusettsEstateTaxSchedule,
  ScheduleLookup,
} from '@/lib/estateTaxSchedules'
import type { EstateTaxScheduleInput } from '@/lib/estateTaxSettings'

/**
 * The estate tax settings screen.
 *
 * It leads with **what is in force today**, because the question this page
 * exists to answer is "does the app have a current figure, and if not, what is
 * missing?" — not "what schedules exist". A federal exclusion nobody has
 * entered is the normal state every January, and it should be the first thing
 * on the page rather than something to infer from a table.
 *
 * The federal figure is fully editable because it is indexed and changes every
 * year. The Massachusetts table is shown read-only: a change there means a new
 * bracket structure, not a new number, and a 21-row editor built for an event
 * that has happened once in a decade would be a lot of surface nobody exercises.
 * The escape hatch is named on the page rather than left to be discovered.
 */

interface EffectiveState {
  asOf: string
  massachusetts: ScheduleLookup<MassachusettsEstateTaxSchedule>
  federal: ScheduleLookup<FederalEstateTaxSchedule>
}

interface Payload {
  configured: EstateTaxScheduleInput[]
  bundled: {
    massachusetts: MassachusettsEstateTaxSchedule[]
    federal: FederalEstateTaxSchedule[]
  }
  errors: string[]
  effective: EffectiveState
}

interface FederalDraft {
  year: string
  exemption: string
  ratePercent: string
  source: string
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`

function emptyFederalDraft(year: number): FederalDraft {
  return { year: String(year), exemption: '', ratePercent: '40', source: '' }
}

export function EstateTaxSchedulesClient({ initial }: { initial: Payload }) {
  const [payload, setPayload] = useState<Payload>(initial)
  const [draft, setDraft] = useState<FederalDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>(initial.errors)
  const [saved, setSaved] = useState(false)

  const thisYear = Number(payload.effective.asOf.slice(0, 4))

  /** Bundled and configured federal schedules together, newest year first. */
  const federalRows = useMemo(() => {
    const configured = payload.configured.filter(
      (schedule): schedule is Extract<EstateTaxScheduleInput, { jurisdiction: 'US' }> =>
        schedule.jurisdiction === 'US',
    )
    const configuredStarts = new Set(configured.map(schedule => schedule.effectiveFrom))
    const rows = [
      ...configured.map(schedule => ({ schedule, origin: 'firm' as const })),
      // A bundled schedule the firm has overridden is not shown twice; the
      // firm's row replaced it, which is what merging does at read time too.
      ...payload.bundled.federal
        .filter(schedule => !configuredStarts.has(schedule.effectiveFrom))
        .map(schedule => ({ schedule, origin: 'built-in' as const })),
    ]
    return rows.sort((a, b) => b.schedule.effectiveFrom.localeCompare(a.schedule.effectiveFrom))
  }, [payload])

  /**
   * A refresh only replaces state with something that is actually a payload.
   *
   * `response.ok` says the request succeeded, not that the body is the shape
   * this component reads — and every field here is dereferenced during render,
   * so an unexpected body takes the whole page down rather than degrading. The
   * write has already happened by this point, so keeping the previous state is
   * the right failure: stale by one save, rather than a blank screen.
   */
  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/estate-tax-schedules')
    if (!response.ok) return
    const body = (await response.json().catch(() => null)) as Partial<Payload> | null
    if (!body || !Array.isArray(body.configured) || !body.effective?.asOf || !body.bundled) return
    setPayload(body as Payload)
  }, [])

  async function persist(schedules: EstateTaxScheduleInput[]) {
    setBusy(true)
    setErrors([])
    setSaved(false)
    try {
      const response = await fetch('/api/admin/estate-tax-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules }),
      })
      const body = (await response.json()) as { errors?: string[] }
      if (!response.ok) {
        setErrors(body.errors ?? ['Could not save the schedules.'])
        return false
      }
      await refresh()
      setSaved(true)
      return true
    } finally {
      setBusy(false)
    }
  }

  function addFederal() {
    if (!draft) return
    const year = Number(draft.year)
    const exemption = Number(draft.exemption.replace(/[$,\s]/g, ''))
    const ratePercent = Number(draft.ratePercent)

    const problems: string[] = []
    if (!Number.isInteger(year) || year < 1900 || year > 2200) problems.push('Enter a four-digit year.')
    if (!Number.isFinite(exemption) || exemption <= 0) problems.push('Enter the exclusion amount in dollars.')
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      problems.push('Enter the rate as a percentage between 0 and 100.')
    }
    if (!draft.source.trim()) {
      problems.push('Record the authority this figure comes from — a revenue procedure or statute.')
    }
    if (problems.length > 0) {
      setErrors(problems)
      return
    }

    const next: EstateTaxScheduleInput = {
      jurisdiction: 'US',
      effectiveFrom: `${year}-01-01`,
      effectiveTo: `${year}-12-31`,
      source: draft.source.trim(),
      exemption,
      // Stored as a fraction; entered as a percentage, because "40" is what a
      // person reads off the code and "0.4" is a thing to get wrong.
      rate: ratePercent / 100,
    }

    const kept = payload.configured.filter(
      schedule => !(schedule.jurisdiction === 'US' && schedule.effectiveFrom === next.effectiveFrom),
    )
    void persist([...kept, next]).then(ok => {
      if (ok) setDraft(null)
    })
  }

  function removeFederal(effectiveFrom: string) {
    void persist(
      payload.configured.filter(
        schedule => !(schedule.jurisdiction === 'US' && schedule.effectiveFrom === effectiveFrom),
      ),
    )
  }

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 2500)
    return () => clearTimeout(timer)
  }, [saved])

  const federal = payload.effective.federal
  const massachusetts = payload.effective.massachusetts

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Estate tax</h1>
        <p className="text-sm text-muted-foreground">
          The figures the app uses to estimate estate tax exposure. Each carries the dates it
          applies to and the authority it came from, and a date no schedule covers reports
          “not on file” rather than falling back to an older number.
        </p>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <ul className="space-y-1 text-sm text-destructive">
            {errors.map(error => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label="In force today" className="grid gap-3 sm:grid-cols-2">
        <div
          className={cn(
            'rounded-lg border p-4',
            federal.ok ? 'border-border bg-card' : 'border-amber-border bg-amber-bg',
          )}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Federal</h2>
            {!federal.ok && <AlertTriangle className="h-4 w-4 text-amber" />}
          </div>
          {federal.ok ? (
            <>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {money(federal.schedule.exemption)}
              </p>
              <p className="text-xs text-muted-foreground">
                exclusion · {Math.round(federal.schedule.rate * 100)}% above it ·{' '}
                {federal.schedule.effectiveFrom.slice(0, 4)}
              </p>
              <p className="mt-2 text-micro text-muted-foreground">{federal.schedule.source}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold text-amber">
                Not on file for {payload.effective.asOf.slice(0, 4)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {federal.mostRecent
                  ? `The most recent figure on file is ${federal.mostRecent.effectiveFrom.slice(0, 4)}. `
                  : ''}
                Estate tax cards show “Not on file” for federal exposure until this year’s exclusion
                is added below — the app will not quote last year’s.
              </p>
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Massachusetts</h2>
          {massachusetts.ok ? (
            <>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {money(massachusetts.schedule.exemption)}
              </p>
              <p className="text-xs text-muted-foreground">
                exemption · {massachusetts.schedule.brackets.length} brackets · in force since{' '}
                {massachusetts.schedule.effectiveFrom}
              </p>
              <p className="mt-2 text-micro text-muted-foreground">{massachusetts.schedule.source}</p>
            </>
          ) : (
            <p className="mt-1 text-lg font-semibold text-amber">
              Not on file for {payload.effective.asOf.slice(0, 4)}
            </p>
          )}
        </div>
      </section>

      <section aria-label="Federal exclusion by year" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Federal exclusion by year</h2>
            <p className="text-xs text-muted-foreground">
              Indexed, so it changes most years. Each year is its own entry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
            {!draft && (
              <Button size="sm" variant="outline" onClick={() => setDraft(emptyFederalDraft(thisYear))}>
                <Plus className="mr-1 h-3 w-3" /> Add a year
              </Button>
            )}
          </div>
        </div>

        {draft && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="etx-year">Year</Label>
                <Input
                  id="etx-year"
                  inputMode="numeric"
                  value={draft.year}
                  onChange={event => setDraft({ ...draft, year: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="etx-exemption">Exclusion amount</Label>
                <Input
                  id="etx-exemption"
                  inputMode="numeric"
                  placeholder="15,000,000"
                  value={draft.exemption}
                  onChange={event => setDraft({ ...draft, exemption: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="etx-rate">Rate above it (%)</Label>
                <Input
                  id="etx-rate"
                  inputMode="decimal"
                  value={draft.ratePercent}
                  onChange={event => setDraft({ ...draft, ratePercent: event.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-4">
                <Label htmlFor="etx-source">Source</Label>
                <Input
                  id="etx-source"
                  placeholder="IRC §2010(c) basic exclusion amount, 2026 (Rev. Proc. …)"
                  value={draft.source}
                  onChange={event => setDraft({ ...draft, source: event.target.value })}
                />
                <p className="text-micro text-muted-foreground">
                  Required. A figure nobody can trace back to an authority is a figure nobody can
                  check.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={addFederal} disabled={busy}>
                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {federalRows.map(({ schedule, origin }) => (
            <li key={schedule.effectiveFrom} className="flex items-center gap-3 p-3">
              <span className="w-14 text-sm font-medium">{schedule.effectiveFrom.slice(0, 4)}</span>
              <span className="w-32 text-sm">{money(schedule.exemption)}</span>
              <span className="w-16 text-sm text-muted-foreground">
                {Math.round(schedule.rate * 100)}%
              </span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{schedule.source}</span>
              <Badge variant={origin === 'firm' ? 'default' : 'secondary'}>{origin}</Badge>
              {origin === 'firm' && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove the ${schedule.effectiveFrom.slice(0, 4)} federal exclusion`}
                  onClick={() => removeFederal(schedule.effectiveFrom)}
                  disabled={busy}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Massachusetts schedule" className="space-y-2">
        <h2 className="text-sm font-semibold">Massachusetts schedule</h2>
        <p className="text-xs text-muted-foreground">
          Read-only here. A Massachusetts change means a new bracket structure rather than a new
          number — H.4104 rewrote the credit and the exemption together — so it lands as a code
          change alongside a test that checks the new table, not as a form entry. The schedule in
          force is shown above with its source.
        </p>
      </section>
    </div>
  )
}
