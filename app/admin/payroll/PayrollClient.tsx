'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PayrollYear } from '@/lib/payroll/server'
import { usePayrollApi } from './payrollApi'
import { RegisterTab } from './RegisterTab'
import { SummaryTab } from './SummaryTab'
import { DeadlinesTab } from './DeadlinesTab'
import { JournalTab } from './JournalTab'
import { ChecklistsTab } from './ChecklistsTab'
import { SetupTab } from './SetupTab'

export type PayrollYearData = PayrollYear

/**
 * Payroll for the firm's owner-employee: the old workbook's tabs as one page.
 * Every figure is computed on the server from the year's settings and runs;
 * this component only displays and edits them.
 */
export default function PayrollClient({ initialYear, today }: { initialYear: number; today: string }) {
  const { token, request } = usePayrollApi()
  const [year, setYear] = useState(initialYear)
  const [data, setData] = useState<PayrollYearData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('register')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      setData(await request<PayrollYearData>(`/api/admin/payroll/runs?year=${year}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payroll')
    } finally {
      setLoading(false)
    }
  }, [request, token, year])

  useEffect(() => { void load() }, [load])

  const needsSetup = data && (!data.settingsStored || !data.settings.ratesConfirmedAt)

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Owner-employee payroll (S corp, Massachusetts): paychecks, deposits, quarterly filings and the journal for Mercury.
          </p>
        </div>
        <div className="flex items-center gap-1" aria-label="Tax year">
          <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => setYear(y => y - 1)}><ChevronLeft /></Button>
          <span className="min-w-14 text-center text-sm font-medium tabular-nums">{year}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next year" onClick={() => setYear(y => y + 1)}><ChevronRight /></Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {needsSetup && tab !== 'setup' && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 text-warning" />
          <span>
            {data!.settingsStored ? `Confirm the ${year} rates against your DUA, DFML and W-4/M-4 figures.` : `No ${year} settings saved yet; figures use the default rates and $0 federal withholding.`}
          </span>
          <Button size="sm" variant="outline" onClick={() => setTab('setup')}>Open Setup</Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="summary">Quarterly &amp; W-2</TabsTrigger>
          <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading payroll…</div>
        ) : data ? (
          <>
            <TabsContent value="register"><RegisterTab year={year} data={data} onChanged={load} /></TabsContent>
            <TabsContent value="summary"><SummaryTab year={year} data={data} /></TabsContent>
            <TabsContent value="deadlines"><DeadlinesTab year={year} today={today} onChanged={load} /></TabsContent>
            <TabsContent value="journal"><JournalTab year={year} data={data} /></TabsContent>
            <TabsContent value="checklists"><ChecklistsTab year={year} data={data} /></TabsContent>
            <TabsContent value="setup"><SetupTab key={`${year}:${data.settings.ratesConfirmedAt ?? ''}:${data.settingsStored}`} year={year} data={data} onSaved={() => { toast.success('Payroll settings saved'); void load() }} /></TabsContent>
          </>
        ) : null}
      </Tabs>

      <p className="text-xs text-muted-foreground">
        General information, not tax advice. Have your CPA review the first quarter&apos;s results and the reasonable-compensation figure.
        S corp items that change W-2 wages (such as health insurance for a more-than-2% shareholder) are not modelled.
      </p>
    </AdminPageShell>
  )
}
