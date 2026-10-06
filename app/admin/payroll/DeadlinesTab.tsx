'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Check, Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { daysBetween } from '@/lib/payroll/dates'
import type { PayrollFiling } from '@/lib/payroll/server'
import type { CalendarSyncResult } from '@/lib/payroll/calendar'
import { usePayrollApi } from './payrollApi'
import { shortDate } from './format'

function FilingRow({ filing, today, onSave }: { filing: PayrollFiling; today: string; onSave: (key: string, body: Record<string, unknown>) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState(filing.confirmation ?? '')
  const [busy, setBusy] = useState(false)
  const days = daysBetween(today, filing.dueDate)
  const isDeposit = Boolean(filing.runId)

  async function toggle() {
    setBusy(true)
    await onSave(filing.key, filing.doneOn ? { doneOn: null } : { doneOn: today, confirmation: confirmation || null })
    setBusy(false)
  }

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-2 pr-3">
        <div className="font-medium">{filing.title}</div>
        <div className="text-xs text-muted-foreground">{filing.agency} · {filing.notes}</div>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{shortDate(filing.dueDate)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">
        {filing.doneOn ? <Badge variant="secondary">Done {shortDate(filing.doneOn)}</Badge>
          : days < 0 ? <Badge variant="destructive">{-days} days overdue</Badge>
          : <span className={days <= 14 ? 'font-medium text-warning' : 'text-muted-foreground'}>{days === 0 ? 'Due today' : `${days} days`}</span>}
      </td>
      <td className="py-2 pr-3">
        {isDeposit ? <span className="text-xs text-muted-foreground">{filing.confirmation ?? 'Record on the Register'}</span>
          : <Input aria-label={`Confirmation for ${filing.title}`} value={confirmation} onChange={e => setConfirmation(e.target.value)} onBlur={() => confirmation !== (filing.confirmation ?? '') && onSave(filing.key, { confirmation: confirmation || null })} className="h-8 w-44" placeholder="Confirmation #" />}
      </td>
      <td className="py-2 text-right">
        {!isDeposit && (
          <Button size="sm" variant={filing.doneOn ? 'ghost' : 'outline'} disabled={busy} onClick={toggle}>
            {busy ? <Loader2 className="animate-spin" /> : filing.doneOn ? <Undo2 /> : <Check />} {filing.doneOn ? 'Reopen' : 'Mark done'}
          </Button>
        )}
        {filing.calendarEventId && <div className="mt-1 text-micro text-muted-foreground">On calendar</div>}
      </td>
    </tr>
  )
}

export function DeadlinesTab({ year, today, onChanged }: { year: number; today: string; onChanged: () => void }) {
  const { token, request } = usePayrollApi()
  const [filings, setFilings] = useState<PayrollFiling[] | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setFilings((await request<{ filings: PayrollFiling[] }>(`/api/admin/payroll/filings?year=${year}`)).filings)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load deadlines')
    }
  }, [request, token, year])

  useEffect(() => { void load() }, [load])

  async function save(key: string, body: Record<string, unknown>) {
    try {
      const result = await request<{ filings: PayrollFiling[] }>(`/api/admin/payroll/filings?year=${year}`, { method: 'PATCH', body: JSON.stringify({ key, ...body }) })
      setFilings(result.filings)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the filing')
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const result = await request<CalendarSyncResult>(`/api/admin/payroll/calendar?year=${year}`, { method: 'POST' })
      if (result.failed.length) toast.error(`${result.failed.length} reminder(s) failed: ${result.failed[0].error}`)
      else toast.success(result.created ? `Added ${result.created} reminder(s) to Google Calendar` : 'Calendar already up to date')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sync the calendar')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Deposit &amp; filing deadlines — {year}</CardTitle>
        <Button size="sm" variant="outline" disabled={syncing} onClick={sync}>
          {syncing ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Sync to calendar
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <p className="mb-3 text-xs text-muted-foreground">
          Weekend due dates move to Monday; holidays are not accounted for, so check the agency calendar. MA withholding deposits follow
          the frequency MassTaxConnect assigned you. The calendar sync adds a 9:00 reminder (not blocking) for each open, upcoming deadline.
        </p>
        {!filings ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Obligation</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Confirmation</th><th />
              </tr>
            </thead>
            <tbody>
              {filings.map(filing => <FilingRow key={`${filing.key}:${filing.doneOn}:${filing.confirmation}`} filing={filing} today={today} onSave={save} />)}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
