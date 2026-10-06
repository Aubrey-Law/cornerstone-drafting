'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { compareSnapshots, describeDelta, type StoredWeeklySnapshot } from '@/lib/billing/weeklySnapshot'
import { money } from './financeFormat'

function weekLabel(snapshot: Pick<StoredWeeklySnapshot, 'weekStart' | 'weekEnd'>): string {
  const [y, m, d] = snapshot.weekStart.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d))
  const [ey, em, ed] = snapshot.weekEnd.split('-').map(Number)
  const end = new Date(Date.UTC(ey, em - 1, ed) - 86_400_000)
  const fmt = (date: Date, year: boolean) => date.toLocaleDateString('en-US', year
    ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt(start, false)} – ${fmt(end, true)}`
}

function DeltaText({ current, previous, goodWhenUp = true }: { current: number; previous: number | null | undefined; goodWhenUp?: boolean }) {
  const described = describeDelta(
    { cents: current - (previous ?? 0), percent: previous && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null },
    { goodWhenUp },
  )
  if (!described.text || described.text === 'no comparison') return null
  return (
    <span className={described.good === null ? 'text-muted-foreground' : described.good ? 'text-green' : 'text-destructive'}>
      {described.text} vs prior week
    </span>
  )
}

/**
 * The Monday snapshot as the page shows it: the latest week's headline
 * figures with week-over-week change, the last weeks in a row, the annual
 * goal (editable by administrators), and a button to run and send it now.
 */
export function WeeklySnapshotCard() {
  const token = useAccessToken()
  const [snapshots, setSnapshots] = useState<StoredWeeklySnapshot[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [goalCents, setGoalCents] = useState<number | null>(null)
  const [goalDraft, setGoalDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [savingGoal, setSavingGoal] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/billing/snapshots', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({})) as { snapshots?: StoredWeeklySnapshot[]; unavailable?: boolean; goalCents?: number; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not load the weekly snapshot')
      setSnapshots(body.snapshots ?? [])
      setUnavailable(body.unavailable === true)
      if (typeof body.goalCents === 'number') {
        setGoalCents(body.goalCents)
        setGoalDraft(String(Math.round(body.goalCents / 100)))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the weekly snapshot')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function runNow() {
    if (!token) return
    setRunning(true)
    try {
      const res = await fetch('/api/admin/billing/snapshots', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({})) as { sent?: boolean; emailStatus?: string | null; error?: string | null }
      if (!res.ok) throw new Error(body.error ?? 'Could not run the snapshot')
      toast.success(body.sent ? 'Snapshot sent to the firm inbox' : `Snapshot stored (email ${body.emailStatus ?? 'not sent'})`)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not run the snapshot')
    } finally {
      setRunning(false)
    }
  }

  async function saveGoal() {
    if (!token) return
    setSavingGoal(true)
    try {
      const dollars = Number(goalDraft.replace(/[$,\s]/g, ''))
      const res = await fetch('/api/admin/settings/billing', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ annualGoalCents: Math.round(dollars * 100) }),
      })
      const body = await res.json().catch(() => ({})) as { annualGoalCents?: number; error?: string }
      if (!res.ok || typeof body.annualGoalCents !== 'number') throw new Error(body.error ?? 'Could not save the goal')
      setGoalCents(body.annualGoalCents)
      setGoalDraft(String(Math.round(body.annualGoalCents / 100)))
      toast.success('Annual goal saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the goal')
    } finally {
      setSavingGoal(false)
    }
  }

  const latest = snapshots[0] ?? null
  const previous = snapshots[1] ?? null
  const comparison = latest ? compareSnapshots(latest, previous) : null
  const goalDirty = goalCents !== null && goalDraft.trim() !== String(Math.round(goalCents / 100))

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
          Weekly snapshot
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Monday morning, the week just ended, emailed to the firm and kept here.
        </p>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Button type="button" size="sm" variant="outline" disabled={running || unavailable} onClick={() => void runNow()}>
            {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            Send now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 py-3 text-sm">
        {loading && snapshots.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…</p>
        ) : unavailable ? (
          <p className="text-xs text-muted-foreground">The snapshot table has not reached this database yet.</p>
        ) : !latest ? (
          <p className="text-xs text-muted-foreground">No week has been snapshotted yet. The first run is next Monday at 8:10 AM, or send one now.</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">Week of {weekLabel(latest)}</p>
              <p className="text-2xl font-semibold tabular-nums">{money(latest.collectedCents)} <span className="text-sm font-normal text-muted-foreground">collected</span></p>
              <p className="text-xs">
                <DeltaText current={latest.collectedCents} previous={previous?.collectedCents ?? latest.previousWeekCollectedCents} />
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Billed</dt>
              <dd className="tabular-nums">{money(latest.billedCents)}</dd>
              <dt className="text-muted-foreground">Outstanding</dt>
              <dd className="tabular-nums">
                {money(latest.outstandingCents)}
                {comparison && previous ? <> <DeltaText current={latest.outstandingCents} previous={previous.outstandingCents} goodWhenUp={false} /></> : null}
              </dd>
              <dt className="text-muted-foreground">Past due</dt>
              <dd className="tabular-nums">{money(latest.overdueCents)} · {latest.overdueCount} item{latest.overdueCount === 1 ? '' : 's'}</dd>
              <dt className="text-muted-foreground">Plan claims unpaid</dt>
              <dd className="tabular-nums">{money(latest.claimsOutstandingCents)}</dd>
              <dt className="text-muted-foreground">Year to date</dt>
              <dd className="tabular-nums">
                {money(latest.ytdCollectedCents)} · {latest.goalProgressPercent}% of goal ·{' '}
                <span className={latest.paceDeltaCents >= 0 ? 'text-green' : 'text-destructive'}>
                  {latest.paceDeltaCents >= 0 ? 'ahead' : 'behind'} by {money(Math.abs(latest.paceDeltaCents))}
                </span>
              </dd>
            </dl>
            {snapshots.length > 1 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-normal">Week</th>
                    <th className="py-1 text-right font-normal">Collected</th>
                    <th className="py-1 text-right font-normal">Outstanding</th>
                    <th className="py-1 text-right font-normal">Past due</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(0, 8).map(row => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-1">{weekLabel(row)}</td>
                      <td className="py-1 text-right tabular-nums">{money(row.collectedCents)}</td>
                      <td className="py-1 text-right tabular-nums">{money(row.outstandingCents)}</td>
                      <td className="py-1 text-right tabular-nums">{money(row.overdueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {goalCents !== null && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Annual collection goal (dollars)</span>
              <Input className="h-8 w-36" inputMode="numeric" value={goalDraft} onChange={e => setGoalDraft(e.target.value)} />
            </label>
            <Button type="button" size="sm" variant="outline" disabled={!goalDirty || savingGoal} onClick={() => void saveGoal()}>
              {savingGoal ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Save goal'}
            </Button>
            <span className="text-xs text-muted-foreground">Administrators only. The snapshot and the goal card above both measure against it.</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
