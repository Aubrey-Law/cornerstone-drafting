import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { buildRows, filterBillingRows } from '@/lib/billing/metrics'
import type { BillingFilter, BillingItem, BillingLedgerRow, BillingPayment } from '@/lib/billing/types'
const target = new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Local fixture required')
const prefix = randomUUID()
function sql(query: string) { return execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port, PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: target.pathname.slice(1) } }).trim() }
const ids = `select md5('${prefix}'||n)::uuid from generate_series(1,1203) n`
type Page = { rows: BillingLedgerRow[]; page: number; total: number; counts: Record<BillingFilter, number> }
function page(overrides: Record<string, unknown> = {}): Page { return JSON.parse(sql(`select public.firm_ledger_page_v1('${JSON.stringify({ page: 1, pageSize: 100, filter: 'all', month: '2026-09', today: '2026-09-10', ...overrides })}'::jsonb)`)) }
beforeAll(() => {
  sql(`insert into public.matters(id,matter_number,name,relationship_status) select md5('${prefix}'||n)::uuid,'${prefix}-'||n,'Synthetic matter '||n,'hired' from generate_series(1,1203) n;
    insert into public.matter_fixture(matter_id,matter_name,client_name,stage,status,practice_area,matter_created) select md5('${prefix}'||n)::uuid,'Synthetic matter','Same client','drafting','open','EP','2026-08-01' from generate_series(1,1203) n;
    insert into public.invoices(id,number,due_date,status) values (md5('${prefix}1')::uuid,'Synthetic void','2026-08-01','void');
    insert into public.billing_items(id,matter_id,kind,label,amount_billed,status,invoiced_at,created_at,invoice_id) select md5('${prefix}'||n)::uuid,md5('${prefix}'||n)::uuid,'flat_fee','Synthetic fee',1000,'invoiced','2026-09-01','2026-08-01',case when n=1 then md5('${prefix}1')::uuid end from generate_series(1,1203) n;
    insert into public.billing_payments(id,billing_item_id,amount,received_at,method) select md5('${prefix}payment'||n)::uuid,md5('${prefix}1')::uuid,1,'2026-09-01 03:30Z','check' from generate_series(1,1000) n;
    insert into public.billing_payments(billing_item_id,amount,received_at,method) values (md5('${prefix}2')::uuid,1000,'2026-09-01 04:30Z','check'),(md5('${prefix}3')::uuid,400,'2026-09-02','check')`)
})
afterAll(() => sql(`delete from public.billing_payments where billing_item_id in (${ids}); delete from public.billing_items where id in (${ids}); delete from public.invoices where id in (${ids}); delete from public.matter_fixture where matter_id in (${ids}); delete from public.matters where id in (${ids})`))
describe('complete ledger read model', () => {
  it('pages beyond 1000 charges without gaps, repeats, or partial totals', () => {
    const first = page(), all = [...first.rows]
    for (let n = 2; n <= Math.ceil(first.total / 100); n++) all.push(...page({ page: n }).rows)
    expect(first.total).toBe(1203)
    expect(new Set(all.map(row => row.id)).size).toBe(1203)
    expect(page({ page: 999 }).page).toBe(13)
    expect(first.counts).toEqual({ all: 1203, open: 1201, paid: 1, overdue: 0, to_invoice: 1201 })
  })
  it('matches charge accounting and firm-local payment months, including all payment rows', () => {
    const rows = [...page({ filter: 'paid', month: '2026-08' }).rows, ...page({ filter: 'paid' }).rows]
    expect(rows).toHaveLength(2)
    expect(rows[0].payments).toHaveLength(1000)
    expect(rows[0].invoiceDueOn).toBeNull()
    for (const row of rows) {
      const { payments, ...item } = row
      const expected = buildRows([item as BillingItem], payments as BillingPayment[], '2026-09-10')[0]
      expect(row.balance).toBe(expected.balance)
      expect(row.collected).toBe(expected.collected)
      expect(row.overdue).toBe(expected.overdue)
      expect(new Date(row.paidAt!).getTime()).toBe(new Date(expected.paidAt!).getTime())
    }
    expect(filterBillingRows(rows, 'paid', '', '2026-08')).toHaveLength(1)
    expect(filterBillingRows(rows, 'paid', '', '2026-09')).toHaveLength(1)
  })
  it('searches the whole matter set and retains a selected matter outside the first 100', () => {
    const selected = sql(`select md5('${prefix}1203')::uuid`)
    const choices = JSON.parse(sql(`select public.firm_billing_matter_options_v1('', '${selected}')`)) as Array<{ id: string; hasLegalFee: boolean }>
    expect(choices).toHaveLength(100)
    expect(choices.find(row => row.id === selected)?.hasLegalFee).toBe(true)
    expect(JSON.parse(sql(`select public.firm_billing_matter_options_v1('${prefix}-1203', null)`))).toHaveLength(1)
    expect(page({ search: `${prefix}-1203` }).total).toBe(1)
    expect(sql("select has_function_privilege('authenticated','public.firm_ledger_page_v1(jsonb)','EXECUTE')")).toBe('f')
  })
})
