import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ fail: false, reads: [] as Array<{ table: string; filters: Array<[string, string, unknown]>; range?: number[] }> }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const read: typeof state.reads[number] = { table, filters: [] }
  state.reads.push(read)
  const chain = {
    select: () => chain, order: () => chain,
    eq: (field: string, value: unknown) => { read.filters.push(['eq', field, value]); return chain },
    in: (field: string, value: unknown) => { read.filters.push(['in', field, value]); return chain },
    gte: (field: string, value: unknown) => { read.filters.push(['gte', field, value]); return chain },
    lt: (field: string, value: unknown) => { read.filters.push(['lt', field, value]); return chain },
    range: (from: number, to: number) => { read.range = [from, to]; return chain },
    then: (resolve: (value: unknown) => unknown) => {
      if (state.fail) return Promise.resolve(resolve({ data: null, count: null, error: { message: 'offline' } }))
      const ids = (read.filters.find(([op]) => op === 'in')?.[2] ?? []) as string[]
      let data: unknown[] = []
      if (table === 'invoices') data = Array.from({ length: 121 }, (_, n) => ({ id: `invoice-${n}`, matter_id: 'selected-matter', kind: 'invoice', status: 'issued', subtotal_cents: 10000, due_date: '2026-09-09', created_at: '2026-09-01' })).slice(read.range?.[0], (read.range?.[1] ?? 120) + 1)
      if (table === 'billing_payments') data = ids.map(invoice_id => ({ invoice_id, amount: 1000 }))
      if (table === 'billing_adjustments') data = ids.flatMap(invoice_id => [{ invoice_id, amount_cents: 2000, balance_effect: 'credit', status: 'posted' }, { invoice_id, amount_cents: 3000, balance_effect: 'credit', status: 'draft' }])
      return Promise.resolve(resolve({ data, error: null, count: table === 'invoices' ? 121 : null }))
    },
  }
  return chain
} }) }))
import { fetchInvoicePage } from '@/lib/queries/invoices'
beforeEach(() => { state.fail = false; state.reads = [] })
describe('invoice page scope and accounting', () => {
  it('uses exact total and scoped half-open issue dates while enriching only visible invoices', async () => {
    const result = await fetchInvoicePage({ page: 3, pageSize: 50, matterId: 'selected-matter', status: 'issued', issueMonth: '2026-09' }, new Date('2026-09-10T12:00Z'))
    expect(result.total).toBe(121)
    expect(result.rows).toHaveLength(21)
    expect(result.rows[0].balance).toBe(7000)
    expect(state.reads[0].range).toEqual([100,149])
    expect(state.reads[0].filters).toEqual([['eq','matter_id','selected-matter'],['eq','status','issued'],['gte','issue_date','2026-09-01'],['lt','issue_date','2026-10-01']])
    expect(state.reads.find(read => read.table === 'billing_payments')?.filters[0][2]).toHaveLength(21)
  })
  it('clamps an out-of-range page and fails visibly when the register is unavailable', async () => {
    expect((await fetchInvoicePage({ page: 99, pageSize: 50 })).page).toBe(3)
    state.fail = true
    await expect(fetchInvoicePage({ page: 1, pageSize: 50 })).rejects.toThrow('unavailable')
  })
})
