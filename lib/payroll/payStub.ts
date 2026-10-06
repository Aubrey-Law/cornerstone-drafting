import 'server-only'

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { sumPaychecks } from './calc'
import { formatCents } from './money'
import type { PayrollSettings, RegisterRow } from './types'

/**
 * A one-page pay stub for one pay date: this check and year to date, with the
 * employer's taxes shown for reference. Built from the register so it always
 * agrees with the page.
 */

const INK = rgb(0.1, 0.1, 0.12)
const MUTED = rgb(0.42, 0.42, 0.46)
const RULE = rgb(0.82, 0.82, 0.85)

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

export async function renderPayStub(settings: PayrollSettings, register: RegisterRow[], runId: string): Promise<Uint8Array> {
  const index = register.findIndex(row => row.id === runId)
  if (index < 0) throw new Error('Payroll run not found')
  const row = register[index]
  const p = row.paycheck
  const ytd = sumPaychecks(register.slice(0, index + 1).map(r => r.paycheck))

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Pay stub ${row.payDate}`)
  pdf.setProducer('Cornerstone payroll')
  const page = pdf.addPage([612, 792])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const left = 54
  const right = 558
  let y = 738

  const text = (pg: PDFPage, value: string, x: number, at: number, font: PDFFont = regular, size = 10, color = INK) =>
    pg.drawText(value, { x, y: at, size, font, color })
  const textRight = (value: string, x: number, at: number, font: PDFFont = regular, size = 10, color = INK) =>
    page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y: at, size, font, color })
  const rule = (at: number) => page.drawLine({ start: { x: left, y: at }, end: { x: right, y: at }, thickness: 0.6, color: RULE })

  text(page, settings.employerName || 'Employer', left, y, bold, 16)
  textRight('EARNINGS STATEMENT', right, y + 2, bold, 11, MUTED)
  y -= 16
  if (settings.employerEin) text(page, `EIN ${settings.employerEin}`, left, y, regular, 9, MUTED)
  y -= 28

  text(page, 'Employee', left, y, bold, 9, MUTED)
  text(page, 'Pay date', 330, y, bold, 9, MUTED)
  text(page, 'Period', 450, y, bold, 9, MUTED)
  y -= 14
  text(page, settings.employeeName || 'Employee', left, y, bold, 11)
  text(page, formatDate(row.payDate), 330, y, regular, 11)
  text(page, `${row.period} of ${settings.payPeriodsPerYear}`, 450, y, regular, 11)
  y -= 13
  for (const line of settings.employeeAddress.split('\n').filter(Boolean).slice(0, 3)) {
    text(page, line, left, y, regular, 9, MUTED)
    y -= 12
  }
  if (settings.employeeSsnLast4) {
    text(page, `SSN ***-**-${settings.employeeSsnLast4}`, left, y, regular, 9, MUTED)
    y -= 12
  }
  y -= 18

  const table = (title: string, lines: [string, number, number][], totalLabel?: string, totals?: [number, number]) => {
    text(page, title, left, y, bold, 10)
    textRight('This period', 450, y, bold, 9, MUTED)
    textRight('Year to date', right, y, bold, 9, MUTED)
    y -= 6
    rule(y)
    y -= 14
    for (const [label, current, toDate] of lines) {
      text(page, label, left, y)
      textRight(formatCents(current), 450, y)
      textRight(formatCents(toDate), right, y)
      y -= 15
    }
    if (totalLabel && totals) {
      rule(y + 10)
      text(page, totalLabel, left, y - 2, bold)
      textRight(formatCents(totals[0]), 450, y - 2, bold)
      textRight(formatCents(totals[1]), right, y - 2, bold)
      y -= 17
    }
    y -= 16
  }

  table('Earnings', [['Gross wages', p.grossCents, ytd.grossCents]])
  table('Withholdings', [
    ['Federal income tax', p.fedWhCents, ytd.fedWhCents],
    ['Social Security', p.ssEeCents, ytd.ssEeCents],
    ['Medicare', p.medicareEeCents, ytd.medicareEeCents],
    ['Massachusetts income tax', p.maWhCents, ytd.maWhCents],
    ['MA Paid Family & Medical Leave', p.pfmlEeCents, ytd.pfmlEeCents],
  ], 'Total withholdings', [p.totalWithholdingCents, ytd.totalWithholdingCents])

  page.drawRectangle({ x: left, y: y - 8, width: right - left, height: 26, color: rgb(0.95, 0.95, 0.97) })
  text(page, 'Net pay', left + 8, y, bold, 12)
  textRight(formatCents(p.netCents), 450, y, bold, 12)
  textRight(formatCents(ytd.netCents), right - 8, y, bold, 12)
  y -= 42

  table('Employer taxes (not deducted from pay)', [
    ['Social Security (employer)', p.ssErCents, ytd.ssErCents],
    ['Medicare (employer)', p.medicareErCents, ytd.medicareErCents],
    ['FUTA', p.futaCents, ytd.futaCents],
    ['MA UI + assessments', p.maUiCents, ytd.maUiCents],
    ...(p.pfmlErCents || ytd.pfmlErCents ? [['MA PFML (employer)', p.pfmlErCents, ytd.pfmlErCents] as [string, number, number]] : []),
  ], 'Total employer taxes', [p.totalEmployerCents, ytd.totalEmployerCents])

  text(page, `Federal tax deposit due ${formatDate(p.fedDepositDue)} (EFTPS).`, left, y, regular, 9, MUTED)
  return pdf.save()
}
