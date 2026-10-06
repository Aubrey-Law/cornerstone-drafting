import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { computeRegister, sameFigures } from './calc'
import { CHECKLISTS, type ChecklistScope } from './checklists'
import { defaultSettings } from './defaults'
import { depositDeadlines, payrollDeadlines, type PayrollDeadline } from './deadlines'
import {
  federalDepositEntry,
  maWithholdingDepositEntry,
  PAYROLL_ACCOUNTS,
  payrollEntry,
  remittanceEntry,
  type JournalEntry,
} from './journal'
import { microsToRate, rateToMicros } from './money'
import { summarizePayroll, type PayrollSummary } from './quarterly'
import type { Paycheck, PayrollRun, PayrollRunStatus, PayrollSettings, RegisterRow } from './types'

/**
 * Payroll records: the half of the module that touches the database. Every
 * figure is computed by the pure modules beside this one; this file loads,
 * stores and keeps draft snapshots current.
 */

type Admin = ReturnType<typeof getAdminClient>
type Row = Record<string, unknown>

/** The migration has not reached this database yet; routes answer 503. */
export class PayrollUnavailableError extends Error {
  constructor() {
    super('The payroll tables have not reached this database yet')
    this.name = 'PayrollUnavailableError'
  }
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return
  if (isMissingRelation(error)) throw new PayrollUnavailableError()
  throw new Error(error.message ?? 'Payroll database error')
}

// ── settings ────────────────────────────────────────────────────────────────

const RATE_COLUMNS = {
  maIncomeTaxMicros: 'ma_income_tax_rate',
  ssRateMicros: 'ss_rate',
  medicareRateMicros: 'medicare_rate',
  addlMedicareRateMicros: 'addl_medicare_rate',
  futaRateMicros: 'futa_rate',
  maUiRateMicros: 'ma_ui_rate',
  maWtfRateMicros: 'ma_wtf_rate',
  maEmacRateMicros: 'ma_emac_rate',
  maCovidRateMicros: 'ma_covid_rate',
  pfmlEmployeeRateMicros: 'pfml_employee_rate',
  pfmlEmployerRateMicros: 'pfml_employer_rate',
} as const

const CENTS_COLUMNS = {
  priorWagesCents: 'prior_wages_cents',
  fedWhPerCheckCents: 'fed_wh_per_check_cents',
  maExemptionCents: 'ma_exemption_cents',
  ssWageBaseCents: 'ss_wage_base_cents',
  addlMedicareThresholdCents: 'addl_medicare_threshold_cents',
  futaWageBaseCents: 'futa_wage_base_cents',
  maUiWageBaseCents: 'ma_ui_wage_base_cents',
} as const

const TEXT_COLUMNS = {
  employerName: 'employer_name',
  employerEin: 'employer_ein',
  employeeName: 'employee_name',
  employeeAddress: 'employee_address',
  employeeSsnLast4: 'employee_ssn_last4',
} as const

export function rowToSettings(row: Row): PayrollSettings {
  const settings = defaultSettings(Number(row.tax_year))
  settings.payPeriodsPerYear = Number(row.pay_periods_per_year ?? settings.payPeriodsPerYear)
  for (const [key, column] of Object.entries(RATE_COLUMNS)) {
    settings[key as keyof typeof RATE_COLUMNS] = rateToMicros(row[column] as number | string)
  }
  for (const [key, column] of Object.entries(CENTS_COLUMNS)) {
    settings[key as keyof typeof CENTS_COLUMNS] = Number(row[column] ?? 0)
  }
  for (const [key, column] of Object.entries(TEXT_COLUMNS)) {
    settings[key as keyof typeof TEXT_COLUMNS] = String(row[column] ?? '')
  }
  settings.pfmlWageCapCents = row.pfml_wage_cap_cents == null ? null : Number(row.pfml_wage_cap_cents)
  settings.ratesConfirmedAt = (row.rates_confirmed_at as string | null) ?? null
  return settings
}

export function settingsToRow(settings: PayrollSettings): Row {
  const row: Row = {
    tax_year: settings.taxYear,
    pay_periods_per_year: settings.payPeriodsPerYear,
    pfml_wage_cap_cents: settings.pfmlWageCapCents,
    rates_confirmed_at: settings.ratesConfirmedAt,
  }
  for (const [key, column] of Object.entries(RATE_COLUMNS)) row[column] = microsToRate(settings[key as keyof typeof RATE_COLUMNS])
  for (const [key, column] of Object.entries(CENTS_COLUMNS)) row[column] = settings[key as keyof typeof CENTS_COLUMNS]
  for (const [key, column] of Object.entries(TEXT_COLUMNS)) row[column] = settings[key as keyof typeof TEXT_COLUMNS]
  return row
}

/** The year's settings; the defaults (not yet stored) when none were saved. */
export async function loadSettings(taxYear: number, admin: Admin = getAdminClient()): Promise<{ settings: PayrollSettings; stored: boolean }> {
  const { data, error } = await admin.from('payroll_settings').select('*').eq('tax_year', taxYear).maybeSingle()
  check(error)
  if (data) return { settings: rowToSettings(data as Row), stored: true }
  // A new year starts from the previous year's rates and names, not the 2026 defaults.
  const { data: previous, error: prevError } = await admin.from('payroll_settings').select('*')
    .lt('tax_year', taxYear).order('tax_year', { ascending: false }).limit(1).maybeSingle()
  check(prevError)
  if (previous) {
    return { settings: { ...rowToSettings(previous as Row), taxYear, priorWagesCents: 0, ratesConfirmedAt: null }, stored: false }
  }
  return { settings: defaultSettings(taxYear), stored: false }
}

export async function saveSettings(settings: PayrollSettings, admin: Admin = getAdminClient()): Promise<PayrollSettings> {
  const { data, error } = await admin.from('payroll_settings')
    .upsert({ ...settingsToRow(settings), updated_at: new Date().toISOString() } as never, { onConflict: 'tax_year' })
    .select('*').single()
  check(error)
  await refreshDraftSnapshots(settings.taxYear, admin)
  return rowToSettings(data as Row)
}

// ── runs ────────────────────────────────────────────────────────────────────

export function rowToRun(row: Row): PayrollRun {
  const computed = row.computed && typeof row.computed === 'object' && 'grossCents' in (row.computed as object)
    ? row.computed as Paycheck
    : null
  return {
    id: String(row.id),
    taxYear: Number(row.tax_year),
    payDate: String(row.pay_date),
    grossCents: Number(row.gross_cents),
    fedWhOverrideCents: row.fed_wh_override_cents == null ? null : Number(row.fed_wh_override_cents),
    status: row.status === 'finalized' ? 'finalized' : 'draft',
    computed,
    netPaidOn: (row.net_paid_on as string | null) ?? null,
    fedDepositPaidOn: (row.fed_deposit_paid_on as string | null) ?? null,
    eftpsConfirmation: (row.eftps_confirmation as string | null) ?? null,
    maDepositPaidOn: (row.ma_deposit_paid_on as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    calendarEventId: (row.calendar_event_id as string | null) ?? null,
  }
}

export async function listRuns(taxYear: number, admin: Admin = getAdminClient()): Promise<PayrollRun[]> {
  const { data, error } = await admin.from('payroll_runs').select('*').eq('tax_year', taxYear).order('pay_date')
  check(error)
  return ((data ?? []) as Row[]).map(rowToRun)
}

export async function getRun(id: string, admin: Admin = getAdminClient()): Promise<PayrollRun | null> {
  const { data, error } = await admin.from('payroll_runs').select('*').eq('id', id).maybeSingle()
  check(error)
  return data ? rowToRun(data as Row) : null
}

/**
 * Bring every draft's stored snapshot up to date with the current settings
 * and the runs before it. Finalized runs are left alone.
 */
export async function refreshDraftSnapshots(taxYear: number, admin: Admin = getAdminClient()): Promise<void> {
  const [{ settings }, runs] = await Promise.all([loadSettings(taxYear, admin), listRuns(taxYear, admin)])
  const register = computeRegister(settings, runs)
  const byId = new Map(runs.map(run => [run.id, run]))
  for (const row of register) {
    const run = byId.get(row.id)!
    if (run.status === 'finalized') continue
    if (run.computed && sameFigures(run.computed, row.paycheck) && run.computed.fedDepositDue === row.paycheck.fedDepositDue) continue
    const { error } = await admin.from('payroll_runs').update({ computed: row.paycheck as never, updated_at: new Date().toISOString() } as never).eq('id', run.id)
    check(error)
  }
}

export interface RunPatch {
  payDate?: string
  grossCents?: number
  fedWhOverrideCents?: number | null
  status?: PayrollRunStatus
  netPaidOn?: string | null
  fedDepositPaidOn?: string | null
  eftpsConfirmation?: string | null
  maDepositPaidOn?: string | null
  notes?: string | null
}

export class PayrollConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollConflictError'
  }
}

export async function createRun(input: { payDate: string; grossCents: number; fedWhOverrideCents: number | null; notes?: string | null }, admin: Admin = getAdminClient()): Promise<PayrollRun> {
  const taxYear = Number(input.payDate.slice(0, 4))
  const { data, error } = await admin.from('payroll_runs').insert({
    tax_year: taxYear,
    pay_date: input.payDate,
    gross_cents: input.grossCents,
    fed_wh_override_cents: input.fedWhOverrideCents,
    notes: input.notes ?? null,
  } as never).select('*').single()
  if (error?.code === '23505') throw new PayrollConflictError('There is already a payroll run on that pay date')
  check(error)
  await refreshDraftSnapshots(taxYear, admin)
  return (await getRun(String((data as Row).id), admin))!
}

/**
 * Inputs (date, gross, override) change only on a draft. Finalizing freezes the
 * current computed figures; un-finalizing hands the run back to recomputation.
 * Deposit tracking can be recorded at any time.
 */
export async function updateRun(id: string, patch: RunPatch, admin: Admin = getAdminClient()): Promise<PayrollRun> {
  const run = await getRun(id, admin)
  if (!run) throw new PayrollConflictError('Payroll run not found')
  const changesInputs = patch.payDate !== undefined || patch.grossCents !== undefined || patch.fedWhOverrideCents !== undefined
  const finalizedAfter = (patch.status ?? run.status) === 'finalized'
  if (changesInputs && finalizedAfter) throw new PayrollConflictError('Un-finalize the run before changing its pay date, wages or withholding')
  if (patch.payDate && patch.payDate.slice(0, 4) !== String(run.taxYear)) {
    throw new PayrollConflictError('A run cannot move to a different tax year; delete it and add it to the other year')
  }

  const update: Row = { updated_at: new Date().toISOString() }
  if (patch.payDate !== undefined) update.pay_date = patch.payDate
  if (patch.grossCents !== undefined) update.gross_cents = patch.grossCents
  if (patch.fedWhOverrideCents !== undefined) update.fed_wh_override_cents = patch.fedWhOverrideCents
  if (patch.netPaidOn !== undefined) update.net_paid_on = patch.netPaidOn
  if (patch.fedDepositPaidOn !== undefined) update.fed_deposit_paid_on = patch.fedDepositPaidOn
  if (patch.eftpsConfirmation !== undefined) update.eftps_confirmation = patch.eftpsConfirmation
  if (patch.maDepositPaidOn !== undefined) update.ma_deposit_paid_on = patch.maDepositPaidOn
  if (patch.notes !== undefined) update.notes = patch.notes

  if (patch.status && patch.status !== run.status) {
    update.status = patch.status
    if (patch.status === 'finalized') {
      // Freeze exactly what the register shows now.
      const [{ settings }, runs] = await Promise.all([loadSettings(run.taxYear, admin), listRuns(run.taxYear, admin)])
      const row = computeRegister(settings, runs).find(r => r.id === id)!
      update.computed = row.paycheck
      update.finalized_at = new Date().toISOString()
    } else {
      update.finalized_at = null
    }
  }

  const { error } = await admin.from('payroll_runs').update(update as never).eq('id', id)
  if (error?.code === '23505') throw new PayrollConflictError('There is already a payroll run on that pay date')
  check(error)
  await refreshDraftSnapshots(run.taxYear, admin)
  return (await getRun(id, admin))!
}

export async function deleteRun(id: string, admin: Admin = getAdminClient()): Promise<void> {
  const run = await getRun(id, admin)
  if (!run) throw new PayrollConflictError('Payroll run not found')
  if (run.status === 'finalized') throw new PayrollConflictError('A finalized run cannot be deleted; un-finalize it first')
  const { error } = await admin.from('payroll_runs').delete().eq('id', id)
  check(error)
  await admin.from('payroll_checklist_items').delete().eq('scope', 'payroll').eq('period_ref', id)
  await refreshDraftSnapshots(run.taxYear, admin)
}

// ── the year at a glance ────────────────────────────────────────────────────

export interface PayrollYear {
  settings: PayrollSettings
  settingsStored: boolean
  runs: PayrollRun[]
  register: RegisterRow[]
  summary: PayrollSummary
}

export async function loadPayrollYear(taxYear: number, admin: Admin = getAdminClient()): Promise<PayrollYear> {
  const [{ settings, stored }, runs] = await Promise.all([loadSettings(taxYear, admin), listRuns(taxYear, admin)])
  const register = computeRegister(settings, runs)
  return { settings, settingsStored: stored, runs, register, summary: summarizePayroll(settings, register) }
}

// ── filings ─────────────────────────────────────────────────────────────────

export interface PayrollFiling extends PayrollDeadline {
  id: string | null
  doneOn: string | null
  confirmation: string | null
  calendarEventId: string | null
  /** For a deposit row: the run it belongs to. */
  runId?: string
}

/**
 * The year's filings, seeded on first read. Existing rows keep their done
 * state; the static titles and agencies come from code so they stay current.
 */
export async function listFilings(taxYear: number, admin: Admin = getAdminClient()): Promise<PayrollFiling[]> {
  const deadlines = payrollDeadlines(taxYear)
  const { error: seedError } = await admin.from('payroll_filings').upsert(
    deadlines.map(d => ({ tax_year: taxYear, key: d.key, due_date: d.dueDate })) as never,
    { onConflict: 'tax_year,key', ignoreDuplicates: true },
  )
  check(seedError)
  const { data, error } = await admin.from('payroll_filings').select('*').eq('tax_year', taxYear)
  check(error)
  const rows = new Map(((data ?? []) as Row[]).map(row => [String(row.key), row]))
  const filings: PayrollFiling[] = deadlines.map(d => {
    const row = rows.get(d.key)
    return {
      ...d,
      dueDate: (row?.due_date as string | undefined) ?? d.dueDate,
      notes: (row?.notes as string | null) || d.notes,
      id: (row?.id as string | undefined) ?? null,
      doneOn: (row?.done_on as string | null) ?? null,
      confirmation: (row?.confirmation as string | null) ?? null,
      calendarEventId: (row?.calendar_event_id as string | null) ?? null,
    }
  })
  // Per-run federal deposits live on the run itself.
  const { register, runs } = await loadPayrollYear(taxYear, admin)
  const runById = new Map(runs.map(run => [run.id, run]))
  for (const deposit of depositDeadlines(register)) {
    const runId = deposit.key.slice('fed-deposit:'.length)
    const run = runById.get(runId)!
    filings.push({
      ...deposit,
      id: null,
      runId,
      doneOn: run.fedDepositPaidOn,
      confirmation: run.eftpsConfirmation,
      calendarEventId: run.calendarEventId,
    })
  }
  return filings.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key))
}

export async function updateFiling(
  taxYear: number,
  key: string,
  patch: { doneOn?: string | null; confirmation?: string | null; notes?: string | null; dueDate?: string },
  admin: Admin = getAdminClient(),
): Promise<void> {
  if (!payrollDeadlines(taxYear).some(d => d.key === key)) throw new PayrollConflictError('Unknown payroll filing')
  await listFilings(taxYear, admin)
  const update: Row = { updated_at: new Date().toISOString() }
  if (patch.doneOn !== undefined) update.done_on = patch.doneOn
  if (patch.confirmation !== undefined) update.confirmation = patch.confirmation
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate
  const { error } = await admin.from('payroll_filings').update(update as never).eq('tax_year', taxYear).eq('key', key)
  check(error)
}

export async function setFilingCalendarEvent(taxYear: number, key: string, eventId: string, admin: Admin = getAdminClient()): Promise<void> {
  if (key.startsWith('fed-deposit:')) {
    const { error } = await admin.from('payroll_runs').update({ calendar_event_id: eventId } as never).eq('id', key.slice('fed-deposit:'.length))
    check(error)
    return
  }
  const { error } = await admin.from('payroll_filings').update({ calendar_event_id: eventId } as never).eq('tax_year', taxYear).eq('key', key)
  check(error)
}

// ── checklists ──────────────────────────────────────────────────────────────

export interface ChecklistTick {
  scope: ChecklistScope
  itemKey: string
  periodRef: string
  doneAt: string
}

export async function listChecklist(taxYear: number, admin: Admin = getAdminClient()): Promise<ChecklistTick[]> {
  const { data, error } = await admin.from('payroll_checklist_items').select('*').eq('tax_year', taxYear)
  check(error)
  return ((data ?? []) as Row[]).map(row => ({
    scope: row.scope as ChecklistScope,
    itemKey: String(row.item_key),
    periodRef: String(row.period_ref ?? ''),
    doneAt: String(row.done_at),
  }))
}

export async function setChecklistItem(
  taxYear: number,
  input: { scope: ChecklistScope; itemKey: string; periodRef: string; done: boolean },
  admin: Admin = getAdminClient(),
): Promise<void> {
  if (!CHECKLISTS[input.scope]?.items.some(item => item.key === input.itemKey)) throw new PayrollConflictError('Unknown checklist item')
  if (input.done) {
    const { error } = await admin.from('payroll_checklist_items').upsert(
      { tax_year: taxYear, scope: input.scope, item_key: input.itemKey, period_ref: input.periodRef } as never,
      { onConflict: 'tax_year,scope,item_key,period_ref', ignoreDuplicates: true },
    )
    check(error)
  } else {
    const { error } = await admin.from('payroll_checklist_items').delete()
      .eq('tax_year', taxYear).eq('scope', input.scope).eq('item_key', input.itemKey).eq('period_ref', input.periodRef)
    check(error)
  }
}

// ── journal ─────────────────────────────────────────────────────────────────

/**
 * Journal entries for a year, a quarter or one run: each payroll, plus the
 * deposits and remittances that have been recorded as paid.
 */
export async function journalEntries(
  taxYear: number,
  scope: { quarter?: 1 | 2 | 3 | 4; runId?: string },
  admin: Admin = getAdminClient(),
): Promise<JournalEntry[]> {
  const { register, runs, summary } = await loadPayrollYear(taxYear, admin)
  const runById = new Map(runs.map(run => [run.id, run]))
  const rows = register.filter(row =>
    (!scope.runId || row.id === scope.runId) && (!scope.quarter || row.paycheck.quarter === scope.quarter))
  const entries: JournalEntry[] = []
  for (const row of rows) {
    const run = runById.get(row.id)!
    entries.push(payrollEntry(row))
    if (run.fedDepositPaidOn) entries.push(federalDepositEntry(row, run.fedDepositPaidOn, run.eftpsConfirmation))
    if (run.maDepositPaidOn) entries.push(maWithholdingDepositEntry(row, run.maDepositPaidOn))
  }
  if (!scope.runId) {
    const filings = await listFilings(taxYear, admin)
    const done = new Map(filings.filter(f => f.doneOn && f.id).map(f => [f.key, f.doneOn!]))
    for (const q of summary.quarters) {
      if (scope.quarter && q.quarter !== scope.quarter) continue
      const dua = done.get(`DUA-Q${q.quarter}`)
      if (dua && q.maUiCents) entries.push(remittanceEntry({ id: `DUA-Q${q.quarter}`, date: dua, memo: `MA DUA contributions, Q${q.quarter}`, account: PAYROLL_ACCOUNTS.maUiPayable, cents: q.maUiCents }))
      const pfml = done.get(`PFML-Q${q.quarter}`)
      if (pfml && q.pfmlCents) entries.push(remittanceEntry({ id: `PFML-Q${q.quarter}`, date: pfml, memo: `MA PFML remittance, Q${q.quarter}`, account: PAYROLL_ACCOUNTS.pfmlPayable, cents: q.pfmlCents }))
    }
    const futa = done.get('940')
    if (futa && !scope.quarter && summary.year.futaCents) {
      entries.push(remittanceEntry({ id: `940-${taxYear}`, date: futa, memo: `FUTA (Form 940) for ${taxYear}`, account: PAYROLL_ACCOUNTS.futaPayable, cents: summary.year.futaCents }))
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
