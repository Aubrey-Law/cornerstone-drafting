'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SETTING_FIELDS } from '@/lib/payroll/defaults'
import type { PayrollSettings } from '@/lib/payroll/types'
import type { PayrollYearData } from './PayrollClient'
import { usePayrollApi } from './payrollApi'
import { dollarsInput, parseDollars, parsePercent, percentInput } from './format'

type Draft = Record<string, string>

function toDraft(settings: PayrollSettings): Draft {
  const draft: Draft = {}
  for (const field of SETTING_FIELDS) {
    const value = settings[field.key] as number | null
    draft[field.key] = field.kind === 'rate' ? percentInput(value ?? 0)
      : field.kind === 'count' ? String(value)
      : dollarsInput(value)
  }
  return draft
}

export function SetupTab({ year, data, onSaved }: { year: number; data: PayrollYearData; onSaved: () => void }) {
  const { request } = usePayrollApi()
  const { settings } = data
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [names, setNames] = useState({
    employerName: settings.employerName, employerEin: settings.employerEin, employeeName: settings.employeeName,
    employeeAddress: settings.employeeAddress, employeeSsnLast4: settings.employeeSsnLast4,
  })
  const [confirmed, setConfirmed] = useState(Boolean(settings.ratesConfirmedAt))
  const [saving, setSaving] = useState(false)

  async function save() {
    const body: Record<string, unknown> = { ...names, ratesConfirmed: confirmed }
    for (const field of SETTING_FIELDS) {
      const text = draft[field.key] ?? ''
      const value = field.kind === 'rate' ? parsePercent(text)
        : field.kind === 'count' ? (/^\d+$/.test(text.trim()) ? Number(text) : null)
        : parseDollars(text)
      if (value == null && field.kind !== 'centsOrNull') {
        toast.error(`${field.label}: enter a valid ${field.kind === 'rate' ? 'percentage' : field.kind === 'count' ? 'number' : 'dollar amount'}`)
        return
      }
      body[field.key] = value
    }
    setSaving(true)
    try {
      await request(`/api/admin/payroll/settings?year=${year}`, { method: 'PUT', body: JSON.stringify(body) })
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Employer &amp; employee</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="s-employer">Employer name</Label><Input id="s-employer" value={names.employerName} onChange={e => setNames(n => ({ ...n, employerName: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="s-ein">Employer EIN</Label><Input id="s-ein" value={names.employerEin} onChange={e => setNames(n => ({ ...n, employerEin: e.target.value }))} placeholder="00-0000000" /></div>
          <div className="space-y-1"><Label htmlFor="s-employee">Employee name</Label><Input id="s-employee" value={names.employeeName} onChange={e => setNames(n => ({ ...n, employeeName: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="s-ssn">SSN — last four only</Label><Input id="s-ssn" inputMode="numeric" maxLength={4} value={names.employeeSsnLast4} onChange={e => setNames(n => ({ ...n, employeeSsnLast4: e.target.value.replace(/\D/g, '') }))} className="w-28" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="s-address">Employee address (for the pay stub)</Label><Textarea id="s-address" rows={2} value={names.employeeAddress} onChange={e => setNames(n => ({ ...n, employeeAddress: e.target.value }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rates &amp; withholding — {year}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Defaults reflect 2026. Fields marked <AlertTriangle className="inline size-3 text-warning" /> must be confirmed against your own
            notices (DUA rate notice, DFML, W-4 / M-4). Saving recomputes every draft run; finalized runs keep their figures. Re-check every rate each January.
          </p>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {SETTING_FIELDS.map(field => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`s-${field.key}`} className="flex items-center gap-1">
                  {field.confirm && <AlertTriangle className="size-3 text-warning" aria-label="Confirm against your notice" />}
                  {field.label}{field.kind === 'rate' ? ' (%)' : field.kind === 'count' ? '' : ' ($)'}
                </Label>
                <Input id={`s-${field.key}`} inputMode="decimal" value={draft[field.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))} className="w-44" />
                <p className="text-xs text-muted-foreground">{field.note}</p>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} />
            I have confirmed the flagged rates for {year} against my notices.
          </label>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save settings</Button>
        </CardContent>
      </Card>
    </div>
  )
}
