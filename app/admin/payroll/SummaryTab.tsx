'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PayrollYearData } from './PayrollClient'
import { usd } from './format'

export function SummaryTab({ year, data }: { year: number; data: PayrollYearData }) {
  const { quarters, year: totals, w2 } = data.summary
  const rows: { label: string; value: (q: (typeof quarters)[number]) => number | string | null; total?: number; hint?: string }[] = [
    { label: 'Gross wages (941 line 2)', value: q => q.wagesCents, total: totals.grossCents },
    { label: 'Federal income tax WH (line 3)', value: q => q.fedWhCents, total: totals.fedWhCents },
    { label: 'SS wages (line 5a)', value: q => q.ssWagesCents },
    { label: 'SS tax × 12.4% (line 5a)', value: q => q.line5aCents },
    { label: 'Medicare wages (line 5c)', value: q => q.medicareWagesCents },
    { label: 'Medicare tax × 2.9% (line 5c)', value: q => q.line5cCents },
    { label: 'Additional Medicare (line 5d)', value: q => q.line5dCents },
    { label: 'Fractions of cents (line 7)', value: q => q.fractionsOfCentsCents, hint: 'Per-check rounding versus the return’s computation.' },
    { label: 'SS + Medicare, both sides (as withheld)', value: q => q.ficaCents },
    { label: 'Total 941 tax (line 12 basis)', value: q => q.total941Cents },
    { label: 'Deposit rule', value: q => q.depositRule },
    { label: 'FUTA liability', value: q => q.futaCents, total: totals.futaCents },
    { label: 'FUTA undeposited, cumulative', value: q => q.futaCumulativeUndepositedCents },
    { label: 'MA income tax WH', value: q => q.maWhCents, total: totals.maWhCents },
    { label: 'MA UI + assessments (DUA)', value: q => q.maUiCents, total: totals.maUiCents },
    { label: 'MA PFML (employee + employer)', value: q => q.pfmlCents, total: totals.pfmlEeCents + totals.pfmlErCents },
  ]
  const cell = (value: number | string | null) => typeof value === 'number' ? usd(value) : value ?? '—'

  const w2Rows: [string, number][] = [
    ['Box 1 — Wages, tips, other compensation', w2.box1WagesCents],
    ['Box 2 — Federal income tax withheld', w2.box2FedWhCents],
    ['Box 3 — Social Security wages', w2.box3SsWagesCents],
    ['Box 4 — Social Security tax withheld', w2.box4SsTaxCents],
    ['Box 5 — Medicare wages and tips', w2.box5MedicareWagesCents],
    ['Box 6 — Medicare tax withheld', w2.box6MedicareTaxCents],
    ['Box 14 — MA PFML withheld (optional)', w2.box14PfmlCents],
    ['Box 16 — State wages (MA)', w2.box16StateWagesCents],
    ['Box 17 — State income tax (MA)', w2.box17StateTaxCents],
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Quarterly summary — Form 941, MA DUA, MA PFML</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3" />
                {quarters.map(q => <th key={q.quarter} className="py-2 pr-3 text-right">Q{q.quarter}{q.runCount ? ` (${q.runCount})` : ''}</th>)}
                <th className="py-2 text-right">Year</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-3" title={row.hint}>{row.label}</td>
                  {quarters.map(q => (
                    <td key={q.quarter} className={`py-1.5 pr-3 text-right tabular-nums ${row.label === 'FUTA undeposited, cumulative' && q.futaDepositDue ? 'font-semibold text-warning' : ''}`}>
                      {cell(row.value(q))}
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums">{row.total !== undefined ? usd(row.total) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {quarters.some(q => q.futaDepositDue) && (
            <p className="mt-3 text-xs text-warning">
              Highlighted: undeposited FUTA passed $500 that quarter; deposit by the last day of the following month.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">W-2 year-end check — {year}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid max-w-2xl gap-1 text-sm">
            {w2Rows.map(([label, cents]) => (
              <div key={label} className="flex justify-between gap-4 border-b py-1 last:border-0">
                <dt>{label}</dt><dd className="tabular-nums">{usd(cents)}</dd>
              </div>
            ))}
          </dl>
          {w2.priorWagesExcludedCents > 0 && (
            <p className="text-xs text-warning">
              {usd(w2.priorWagesExcludedCents)} of wages paid before the first run here is not included above; add it and its withholding before filing.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Boxes 3 and 5 equal Box 1 unless wages pass the Social Security base or there are pre-tax items. Tie every figure to what was actually deposited before filing.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
