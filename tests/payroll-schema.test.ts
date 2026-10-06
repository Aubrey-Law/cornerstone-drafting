import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20270119090000_payroll.sql'), 'utf8')
const TABLES = ['payroll_settings', 'payroll_runs', 'payroll_filings', 'payroll_checklist_items']

describe('payroll migration', () => {
  it('creates the four tables with integer-cent money', () => {
    for (const table of TABLES) expect(sql).toContain(`create table if not exists public.${table}`)
    expect(sql).toContain('gross_cents            bigint not null check (gross_cents > 0)')
    expect(sql).toContain("status                 text not null default 'draft' check (status in ('draft', 'finalized'))")
    expect(sql).toContain('unique (tax_year, pay_date)')
  })

  it('never stores more than the last four SSN digits', () => {
    expect(sql).toContain("employee_ssn_last4             text not null default '' check (employee_ssn_last4 ~ '^([0-9]{4})?$')")
    expect(sql).not.toMatch(/\bssn\s+text/)
  })

  it('locks reads to administrators and writes to the service role', () => {
    expect(sql).toContain("array['payroll_settings', 'payroll_runs', 'payroll_filings', 'payroll_checklist_items']")
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('revoke all on table public.%I from public, anon, authenticated')
    expect(sql).toContain('grant select on table public.%I to authenticated')
    expect(sql).toContain("u.role = ''admin''")
    expect(sql).not.toContain("'attorney'")
    expect(sql).not.toMatch(/grant (insert|update|delete)/i)
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true)
  })
})
