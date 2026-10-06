'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect } from '@/components/ui/native-select'
import { CHECKLISTS, CHECKLIST_SCOPES, checklistNeedsPeriod, type ChecklistScope } from '@/lib/payroll/checklists'
import type { ChecklistTick } from '@/lib/payroll/server'
import type { PayrollYearData } from './PayrollClient'
import { usePayrollApi } from './payrollApi'
import { shortDate } from './format'

export function ChecklistsTab({ year, data }: { year: number; data: PayrollYearData }) {
  const { token, request } = usePayrollApi()
  const [ticks, setTicks] = useState<ChecklistTick[]>([])
  const [runRef, setRunRef] = useState(data.register.at(-1)?.id ?? '')
  const [quarterRef, setQuarterRef] = useState(String(data.register.at(-1)?.paycheck.quarter ?? 1))

  const load = useCallback(async () => {
    if (!token) return
    try {
      setTicks((await request<{ items: ChecklistTick[] }>(`/api/admin/payroll/checklist?year=${year}`)).items)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the checklists')
    }
  }, [request, token, year])

  useEffect(() => { void load() }, [load])

  const periodFor = (scope: ChecklistScope) => scope === 'payroll' ? runRef : scope === 'quarter' ? quarterRef : ''

  async function toggle(scope: ChecklistScope, itemKey: string, done: boolean) {
    const periodRef = periodFor(scope)
    try {
      const result = await request<{ items: ChecklistTick[] }>(`/api/admin/payroll/checklist?year=${year}`, {
        method: 'PATCH', body: JSON.stringify({ scope, itemKey, periodRef, done }),
      })
      setTicks(result.items)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the checklist')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {CHECKLIST_SCOPES.map(scope => {
        const list = CHECKLISTS[scope]
        const periodRef = periodFor(scope)
        const disabled = scope === 'payroll' && !runRef
        const done = new Set(ticks.filter(t => t.scope === scope && t.periodRef === periodRef).map(t => t.itemKey))
        return (
          <Card key={scope}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{list.title}</CardTitle>
              {checklistNeedsPeriod(scope) && (scope === 'payroll' ? (
                <NativeSelect aria-label="Pay date" value={runRef} onChange={e => setRunRef(e.target.value)} className="w-52">
                  {data.register.length === 0 && <option value="">No pay dates yet</option>}
                  {data.register.map(r => <option key={r.id} value={r.id}>Period {r.period} · {shortDate(r.payDate)}</option>)}
                </NativeSelect>
              ) : (
                <NativeSelect aria-label="Quarter" value={quarterRef} onChange={e => setQuarterRef(e.target.value)} className="w-28">
                  {[1, 2, 3, 4].map(q => <option key={q} value={String(q)}>Q{q}</option>)}
                </NativeSelect>
              ))}
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {list.items.map(item => {
                  const id = `cl-${scope}-${item.key}`
                  return (
                    <li key={item.key} className="flex gap-3">
                      <Checkbox id={id} checked={done.has(item.key)} disabled={disabled} onCheckedChange={value => toggle(scope, item.key, value === true)} className="mt-0.5" />
                      <label htmlFor={id} className="text-sm">
                        <span className={done.has(item.key) ? 'text-muted-foreground line-through' : ''}>{item.task}</span>
                        {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
