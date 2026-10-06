'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, Plus, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/useConfirm'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { firmTodayKey } from '@/lib/firmDate'
import { formatElapsed, formatHours, parseDuration, type RunningTimer, type TimeEntry, type TimeEntrySource } from '@/lib/timeEntries/model'

interface TimeSummary {
  entries: TimeEntry[]
  totalMinutes: number
  timer: RunningTimer | null
  timerElsewhere: RunningTimer | null
  unavailable: boolean
}

const SOURCE_LABEL: Record<TimeEntrySource, string | null> = {
  timer: 'timer',
  manual: null,
  suggested: 'suggested',
}

/**
 * Time on the matter: a timer that follows the attorney across devices, a line
 * to type time in, and the list. Suggestions from the activity log arrive on
 * Today and land here once approved.
 */
export function TimeEntriesCard({ matterId }: { matterId: string }) {
  const token = useAccessToken()
  const { confirm, confirmDialog } = useConfirm()
  const [summary, setSummary] = useState<TimeSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [timerNote, setTimerNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [workDate, setWorkDate] = useState(() => firmTodayKey())

  const headers = useCallback(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token])
  const base = `/api/admin/matters/${matterId}/time-entries`

  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      setSummary(await apiRequest<TimeSummary>(base, { headers: headers() }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Time entries are unavailable.')
    }
  }, [token, base, headers])

  useEffect(() => { void load() }, [load])

  const running = summary?.timer ?? null
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  async function run(task: () => Promise<void>, failure: string) {
    if (!token) return
    setBusy(true)
    try {
      await task()
      await load()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : failure)
    } finally {
      setBusy(false)
    }
  }

  const start = () => run(async () => {
    const result = await apiRequest<{ stopped: TimeEntry | null }>(`${base}/timer`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ description: timerNote.trim() || null }),
    }, 'Could not start the timer')
    setNow(new Date())
    if (result.stopped) toast.success(`Stopped the other timer and logged ${formatHours(result.stopped.minutes)}`)
  }, 'Could not start the timer')

  const stop = () => run(async () => {
    const result = await apiRequest<{ entry: TimeEntry | null }>(`${base}/timer`, { method: 'DELETE', headers: headers() }, 'Could not stop the timer')
    setTimerNote('')
    if (result.entry) toast.success(`Logged ${formatHours(result.entry.minutes)}`)
  }, 'Could not stop the timer')

  const discard = async () => {
    if (!(await confirm({ title: 'Discard the running timer?', body: 'The time it has run is not recorded.', confirmLabel: 'Discard', destructive: true }))) return
    await run(async () => {
      await apiRequest(`${base}/timer?discard=1`, { method: 'DELETE', headers: headers() }, 'Could not discard the timer')
    }, 'Could not discard the timer')
  }

  const minutes = parseDuration(duration)
  const add = () => run(async () => {
    if (!minutes) throw new Error('Enter the time as hours (1.5), hours and minutes (1:30), or minutes (45m)')
    await apiRequest(base, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ minutes, description: description.trim(), workDate }),
    }, 'Could not record the time')
    toast.success(`Logged ${formatHours(minutes)}`)
    setDuration('')
    setDescription('')
    setAdding(false)
  }, 'Could not record the time')

  const remove = async (entry: TimeEntry) => {
    if (!(await confirm({ title: `Remove ${formatHours(entry.minutes)} from ${entry.workDate}?`, body: entry.description, confirmLabel: 'Remove', destructive: true }))) return
    await run(async () => {
      await apiRequest(`${base}/${entry.id}`, { method: 'DELETE', headers: headers() }, 'Could not remove the entry')
    }, 'Could not remove the entry')
  }

  return (
    <section className="rounded-lg border border-border bg-card" data-testid="time-entries">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Time</h3>
          <p className="text-xs text-muted-foreground">
            {summary?.unavailable
              ? 'Time entries arrive with the next database update.'
              : `${formatHours(summary?.totalMinutes ?? 0)} recorded · not invoiced`}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={summary?.unavailable} onClick={() => setAdding(current => !current)}>
          <Plus className="h-3.5 w-3.5" />
          Add time
        </Button>
      </div>

      {!summary?.unavailable && (
        <div className="space-y-2 border-b border-border px-4 py-3">
          {running ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-lg tabular-nums" aria-live="off">{formatElapsed(running.startedAt, now)}</p>
                {running.description && <p className="truncate text-xs text-muted-foreground">{running.description}</p>}
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={() => void stop()}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  Stop and log
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label="Discard timer" disabled={busy} onClick={() => void discard()}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void start() }}>
              <Input
                aria-label="What are you working on?"
                value={timerNote}
                onChange={event => setTimerNote(event.target.value)}
                placeholder="What are you working on?"
                maxLength={2000}
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={busy}>
                <Play className="h-3.5 w-3.5" />
                Start timer
              </Button>
            </form>
          )}
          {summary?.timerElsewhere && (
            <p className="text-xs text-muted-foreground">Your timer is running on another matter; starting one here stops and logs that one.</p>
          )}
        </div>
      )}

      {adding && (
        <form className="grid gap-2 border-b border-border px-4 py-3" onSubmit={event => { event.preventDefault(); void add() }}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="time-duration" className="text-xs">Time</Label>
              <Input id="time-duration" value={duration} onChange={event => setDuration(event.target.value)} placeholder="1.5 or 1:30 or 45m" required />
            </div>
            <div>
              <Label htmlFor="time-date" className="text-xs">Date</Label>
              <Input id="time-date" type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="time-description" className="text-xs">What was done</Label>
            <Input id="time-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="Reviewed the deed and called the client" maxLength={2000} required />
          </div>
          <Button type="submit" size="sm" disabled={busy || !minutes || !description.trim()} className="justify-self-end gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Log {minutes ? formatHours(minutes) : 'time'}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void load()}>Retry</Button></p>
      )}
      {!summary && !error && <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>}
      {summary && !summary.unavailable && summary.entries.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">No time yet. Work logged on the matter is suggested each morning on Today.</p>
      )}
      {summary && summary.entries.length > 0 && (
        <ul className="max-h-80 divide-y divide-border/60 overflow-y-auto">
          {summary.entries.map(entry => {
            const source = SOURCE_LABEL[entry.source]
            return (
              <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{entry.description}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground">
                    <span>{entry.workDate}</span>
                    {source && <Badge variant="outline" className="px-1 py-0 text-micro">{source}</Badge>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm tabular-nums">{formatHours(entry.minutes)}</span>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove entry" disabled={busy} onClick={() => void remove(entry)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  )
}
