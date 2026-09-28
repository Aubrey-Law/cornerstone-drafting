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
    lte: (field: string, value: unknown) => { read.filters.push(['lte', field, value]); return chain },
    ilike: (field: string, value: unknown) => { read.filters.push(['ilike', field, value]); return chain },
    limit: () => chain,
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
    const pageRead = state.reads.find(read => read.table === 'invoices' && read.range)
    expect(pageRead?.range).toEqual([100,149])
    expect(pageRead?.filters).toEqual([['eq','matter_id','selected-matter'],['eq','status','issued'],['gte','issue_date','2026-09-01'],['lt','issue_date','2026-10-01']])
    expect(state.reads.find(read => read.table === 'billing_payments')?.filters[0][2]).toHaveLength(21)
  })
  it('clamps an out-of-range page and fails visibly when the register is unavailable', async () => {
    expect((await fetchInvoicePage({ page: 99, pageSize: 50, queue: 'all' })).page).toBe(3)
    state.fail = true
    await expect(fetchInvoicePage({ page: 1, pageSize: 50 })).rejects.toThrow('unavailable')
  })

  it('scopes collection queues to invoices and applies firm-date urgency bounds', async () => {
    await fetchInvoicePage({ page: 1, pageSize: 50, queue: 'past_due' }, new Date('2026-09-10T12:00Z'))

    const pageRead = state.reads.find(read => read.table === 'invoices' && read.range)
    expect(pageRead?.filters).toEqual([
      ['eq', 'kind', 'invoice'],
      ['in', 'status', ['issued', 'partial']],
      ['lt', 'due_date', '2026-09-10'],
    ])
    expect(state.reads.some(read => read.filters.some(filter =>
      filter[0] === 'lte' && filter[1] === 'due_date' && filter[2] === '2026-09-24',
    ))).toBe(true)
  })

  it('builds the default attention page in past-due, due-soon, then draft order', async () => {
    const result = await fetchInvoicePage({ page: 1, pageSize: 50 }, new Date('2026-09-10T12:00Z'))

    const pageRead = state.reads.find(read => read.table === 'invoices' && read.range)
    expect(pageRead?.filters).toEqual([
      ['eq', 'kind', 'invoice'],
      ['in', 'status', ['issued', 'partial']],
      ['lt', 'due_date', '2026-09-10'],
    ])
    expect(result.counts.attention).toBe(
      result.counts.past_due + result.counts.due_soon + result.counts.draft,
    )
  })

  it('searches invoice, client, and matter identifiers before applying exact pagination', async () => {
    await fetchInvoicePage({ page: 1, pageSize: 50, queue: 'all', search: 'A_B%' })

    expect(state.reads.some(read => read.table === 'invoices' && read.filters.some(filter =>
      filter[0] === 'ilike' && filter[1] === 'number' && filter[2] === '%A\\_B\\%%',
    ))).toBe(true)
    expect(state.reads.some(read => read.table === 'invoices' && read.filters.some(filter =>
      filter[0] === 'ilike' && filter[1] === 'bill_to_name',
    ))).toBe(true)
    expect(state.reads.some(read => read.table === 'matters' && read.filters.some(filter =>
      filter[0] === 'ilike' && filter[1] === 'matter_number',
    ))).toBe(true)
    expect(state.reads.some(read => read.table === 'v_matter_pipeline' && read.filters.some(filter =>
      filter[0] === 'ilike' && filter[1] === 'client_name',
    ))).toBe(true)
    const pageRead = state.reads.find(read => read.table === 'invoices' && read.range)
    expect(pageRead?.filters.some(filter => filter[0] === 'in' && filter[1] === 'id')).toBe(true)
  })
})
