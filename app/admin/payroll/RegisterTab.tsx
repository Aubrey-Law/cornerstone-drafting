'use client'

import { Fragment, useMemo, useState } from 'react'
import { Download, FileText, Lock, LockOpen, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/useConfirm'
import { computeRegister, sumPaychecks } from '@/lib/payroll/calc'
import type { Paycheck, PayrollRun, RegisterRow } from '@/lib/payroll/types'
import type { PayrollYearData } from './PayrollClient'
import { usePayrollApi } from './payrollApi'
import { dollarsInput, parseDollars, shortDate, usd } from './format'

const COLUMNS: { key: keyof Paycheck; label: string; group: 'ee' | 'er' | 'sum' }[] = [
  { key: 'grossCents', label: 'Gross', group: 'sum' },
  { key: 'fedWhCents', label: 'Fed WH', group: 'ee' },
  { key: 'ssEeCents', label: 'SS', group: 'ee' },
  { key: 'medicareEeCents', label: 'Medicare', group: 'ee' },
  { key: 'maWhCents', label: 'MA WH', group: 'ee' },
  { key: 'pfmlEeCents', label: 'PFML', group: 'ee' },
  { key: 'netCents', label: 'Net pay', group: 'sum' },
  { key: 'ssErCents', label: 'SS (er)', group: 'er' },
  { key: 'medicareErCents', label: 'Medicare (er)', group: 'er' },
  { key: 'futaCents', label: 'FUTA', group: 'er' },
  { key: 'maUiCents', label: 'MA UI', group: 'er' },
  { key: 'totalEmployerCents', label: 'Employer tax', group: 'sum' },
  { key: 'totalCostCents', label: 'Total cost', group: 'sum' },
]

function PaycheckPreview({ paycheck }: { paycheck: Paycheck }) {
  const rows: [string, number][] = [
    ['Federal income tax', paycheck.fedWhCents],
    ['Social Security', paycheck.ssEeCents],
    ['Medicare', paycheck.medicareEeCents],
    ['MA income tax', paycheck.maWhCents],
    ['MA PFML', paycheck.pfmlEeCents],
  ]
  return (
    <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
      <div className="space-y-1">
        {rows.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{usd(cents)}</span></div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><span>Net pay</span><span className="tabular-nums">{usd(paycheck.netCents)}</span></div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Employer taxes</span><span className="tabular-nums">{usd(paycheck.totalEmployerCents)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total payroll cost</span><span className="tabular-nums">{usd(paycheck.totalCostCents)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Federal deposit due</span><span>{shortDate(paycheck.fedDepositDue)}</span></div>
      </div>
    </div>
  )
}

function NewRunForm({ year, data, onCreated }: { year: number; data: PayrollYearData; onCreated: () => void }) {
  const { request } = usePayrollApi()
  const [payDate, setPayDate] = useState('')
  const [gross, setGross] = useState('')
  const [override, setOverride] = useState('')
  const [saving, setSaving] = useState(false)

  const grossCents = parseDollars(gross)
  const overrideCents = parseDollars(override)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(payDate) && payDate.startsWith(String(year))
  const preview = useMemo(() => {
    if (!validDate || !grossCents) return null
    const draft = { id: '~preview', payDate, grossCents, fedWhOverrideCents: overrideCents, status: 'draft' as const, computed: null }
    return computeRegister(data.settings, [...data.runs, draft]).find(row => row.id === '~preview')?.paycheck ?? null
  }, [data, grossCents, overrideCents, payDate, validDate])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!validDate || !grossCents) return
    setSaving(true)
    try {
      await request('/api/admin/payroll/runs', { method: 'POST', body: JSON.stringify({ payDate, grossCents, fedWhOverrideCents: overrideCents }) })
      toast.success('Payroll run added')
      setGross('')
      setOverride('')
      setPayDate('')
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the run')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Run payroll</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="pr-date">Pay date</Label>
            <Input id="pr-date" type="date" value={payDate} min={`${year}-01-01`} max={`${year}-12-31`} onChange={e => setPayDate(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-gross">Gross wages</Label>
            <Input id="pr-gross" inputMode="decimal" placeholder="5,000.00" value={gross} onChange={e => setGross(e.target.value)} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-override">Federal WH override</Label>
            <Input id="pr-override" inputMode="decimal" placeholder={dollarsInput(data.settings.fedWhPerCheckCents)} value={override} onChange={e => setOverride(e.target.value)} className="w-36" />
          </div>
          <Button type="submit" disabled={!validDate || !grossCents || saving || (override !== '' && overrideCents == null)}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} Add pay date
          </Button>
        </form>
        {payDate && !validDate && <p className="text-xs text-destructive">The pay date must fall in {year}.</p>}
        {gross && !grossCents && <p className="text-xs text-destructive">Enter gross wages in dollars.</p>}
        {preview && <PaycheckPreview paycheck={preview} />}
      </CardContent>
    </Card>
  )
}

function RunDetails({ row, run, year, onChanged }: { row: RegisterRow; run: PayrollRun; year: number; onChanged: () => void }) {
  const { request, download } = usePayrollApi()
  const { confirm, confirmDialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [fedPaid, setFedPaid] = useState(run.fedDepositPaidOn ?? '')
  const [eftps, setEftps] = useState(run.eftpsConfirmation ?? '')
  const [maPaid, setMaPaid] = useState(run.maDepositPaidOn ?? '')
  const [netPaid, setNetPaid] = useState(run.netPaidOn ?? '')

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label)
    try {
      await request(`/api/admin/payroll/runs/${run.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the run')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    const confirmed = await confirm({
      title: `Delete the ${row.payDate} payroll run?`,
      body: 'Only draft runs can be deleted. This cannot be undone.',
      confirmLabel: 'Delete run',
      destructive: true,
    })
    if (!confirmed) return
    setBusy('delete')
    try {
      await request(`/api/admin/payroll/runs/${run.id}`, { method: 'DELETE' })
      toast.success('Run deleted')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the run')
    } finally {
      setBusy(null)
    }
  }

  async function save(path: string, filename: string, label: string) {
    setBusy(label)
    try { await download(path, filename) } catch (err) { toast.error(err instanceof Error ? err.message : 'Download failed') } finally { setBusy(null) }
  }

  const finalized = run.status === 'finalized'
  return (
    <div className="space-y-4 rounded-md border bg-muted p-4">
      {confirmDialog}
      <PaycheckPreview paycheck={row.paycheck} />
      {row.driftsFromSettings && (
        <p className="text-xs text-warning">This finalized check keeps the figures it was paid with; today&apos;s settings would compute it differently.</p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor={`np-${run.id}`}>Net pay sent</Label><Input id={`np-${run.id}`} type="date" value={netPaid} onChange={e => setNetPaid(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label htmlFor={`fd-${run.id}`}>Federal deposit paid</Label><Input id={`fd-${run.id}`} type="date" value={fedPaid} onChange={e => setFedPaid(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label htmlFor={`ef-${run.id}`}>EFTPS confirmation #</Label><Input id={`ef-${run.id}`} value={eftps} onChange={e => setEftps(e.target.value)} className="w-48" /></div>
        <div className="space-y-1"><Label htmlFor={`ma-${run.id}`}>MA WH deposit paid</Label><Input id={`ma-${run.id}`} type="date" value={maPaid} onChange={e => setMaPaid(e.target.value)} className="w-40" /></div>
        <Button variant="outline" disabled={busy !== null} onClick={() => patch({ netPaidOn: netPaid || null, fedDepositPaidOn: fedPaid || null, eftpsConfirmation: eftps || null, maDepositPaidOn: maPaid || null }, 'track')}>
          {busy === 'track' && <Loader2 className="animate-spin" />} Save deposits
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={finalized ? 'outline' : 'default'} disabled={busy !== null} onClick={() => patch({ status: finalized ? 'draft' : 'finalized' }, 'status')}>
          {finalized ? <LockOpen /> : <Lock />} {finalized ? 'Un-finalize' : 'Finalize'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => save(`/api/admin/payroll/runs/${run.id}/stub`, `pay-stub-${row.payDate}.pdf`, 'stub')}>
          {busy === 'stub' ? <Loader2 className="animate-spin" /> : <FileText />} Pay stub PDF
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => save(`/api/admin/payroll/journal?year=${year}&run=${run.id}`, `payroll-journal-${row.payDate}.csv`, 'journal')}>
          {busy === 'journal' ? <Loader2 className="animate-spin" /> : <Download />} Journal CSV
        </Button>
        {!finalized && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={remove}><Trash2 /> Delete</Button>
        )}
      </div>
    </div>
  )
}

export function RegisterTab({ year, data, onChanged }: { year: number; data: PayrollYearData; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const runById = new Map(data.runs.map(run => [run.id, run]))
  const totals = sumPaychecks(data.register.map(row => row.paycheck))

  return (
    <div className="space-y-4">
      <NewRunForm year={year} data={data} onCreated={onChanged} />
      <Card>
        <CardHeader><CardTitle className="text-base">Register — {year}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {data.register.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No pay dates in {year} yet.</p>
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Pay date</th>
                  {COLUMNS.map(col => <th key={col.key} className="py-2 pr-2 text-right">{col.label}</th>)}
                  <th className="py-2 pr-2">Fed deposit</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.register.map(row => {
                  const run = runById.get(row.id)!
                  const open = openId === row.id
                  return (
                    <Fragment key={row.id}>
                      <tr className="cursor-pointer border-b hover:bg-accent" onClick={() => setOpenId(open ? null : row.id)} aria-expanded={open}>
                        <td className="py-2 pr-2 tabular-nums">{row.period}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{shortDate(row.payDate)}</td>
                        {COLUMNS.map(col => (
                          <td key={col.key} className={`py-2 pr-2 text-right tabular-nums ${col.group === 'sum' ? 'font-medium' : ''}`}>{usd(row.paycheck[col.key] as number)}</td>
                        ))}
                        <td className="py-2 pr-2 whitespace-nowrap text-xs">
                          {run.fedDepositPaidOn ? <span className="text-green">Paid {shortDate(run.fedDepositPaidOn)}</span> : <span>Due {shortDate(row.paycheck.fedDepositDue)}</span>}
                        </td>
                        <td className="py-2"><Badge variant={run.status === 'finalized' ? 'secondary' : 'outline'}>{run.status === 'finalized' ? 'Finalized' : 'Draft'}</Badge></td>
                      </tr>
                      {open && (
                        <tr><td colSpan={COLUMNS.length + 4} className="py-3"><RunDetails key={`${run.id}:${run.status}`} row={row} run={run} year={year} onChanged={onChanged} /></td></tr>
                      )}
                    </Fragment>
                  )
                })}
                <tr className="font-semibold">
                  <td className="py-2 pr-2" colSpan={2}>Totals</td>
                  {COLUMNS.map(col => <td key={col.key} className="py-2 pr-2 text-right tabular-nums">{usd(totals[col.key as keyof typeof totals] as number)}</td>)}
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
