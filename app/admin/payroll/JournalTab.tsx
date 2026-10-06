'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { entryTotals, payrollEntry } from '@/lib/payroll/journal'
import type { PayrollYearData } from './PayrollClient'
import { usePayrollApi } from './payrollApi'
import { shortDate, usd } from './format'

export function JournalTab({ year, data }: { year: number; data: PayrollYearData }) {
  const { download } = usePayrollApi()
  const [runId, setRunId] = useState(data.register.at(-1)?.id ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const row = data.register.find(r => r.id === runId) ?? null
  const entry = row ? payrollEntry(row) : null
  const totals = entry ? entryTotals(entry) : null

  async function save(query: string, filename: string, label: string) {
    setBusy(label)
    try { await download(`/api/admin/payroll/journal?year=${year}${query}`, filename) } catch (err) { toast.error(err instanceof Error ? err.message : 'Download failed') } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Journal entry for a pay date</CardTitle>
          <NativeSelect aria-label="Pay date" value={runId} onChange={e => setRunId(e.target.value)} className="w-56">
            {data.register.length === 0 && <option value="">No pay dates yet</option>}
            {data.register.map(r => <option key={r.id} value={r.id}>Period {r.period} · {shortDate(r.payDate)}</option>)}
          </NativeSelect>
        </CardHeader>
        <CardContent>
          {entry && totals ? (
            <div className="space-y-3">
              <table className="w-full max-w-3xl text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Account</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th></tr></thead>
                <tbody>
                  {entry.lines.map(line => (
                    <tr key={line.account} className="border-b">
                      <td className="py-1.5">{line.account}</td>
                      <td className="py-1.5 text-right tabular-nums">{line.debitCents ? usd(line.debitCents) : ''}</td>
                      <td className="py-1.5 text-right tabular-nums">{line.creditCents ? usd(line.creditCents) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5">Totals</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(totals.debitCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(totals.creditCents)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={totals.balanced ? 'secondary' : 'destructive'}>{totals.balanced ? 'Balanced' : 'CHECK'}</Badge>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => save(`&run=${row!.id}`, `payroll-journal-${row!.payDate}.csv`, 'run')}>
                  {busy === 'run' ? <Loader2 className="animate-spin" /> : <Download />} This pay date (CSV)
                </Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Add a pay date on the Register to see its entry.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Export for Mercury Accounting</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each export holds the payroll entries plus every deposit and remittance recorded as paid (EFTPS and MA withholding deposits on the
            Register; DUA, PFML and Form 940 when marked done on Deadlines), each crediting cash. Account names are suggestions; map them to your chart of accounts.
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map(q => (
              <Button key={q} size="sm" variant="outline" disabled={busy !== null} onClick={() => save(`&quarter=${q}`, `payroll-journal-${year}-Q${q}.csv`, `q${q}`)}>
                {busy === `q${q}` ? <Loader2 className="animate-spin" /> : <Download />} Q{q}
              </Button>
            ))}
            <Button size="sm" disabled={busy !== null} onClick={() => save('', `payroll-journal-${year}.csv`, 'year')}>
              {busy === 'year' ? <Loader2 className="animate-spin" /> : <Download />} Full year
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
