import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firmDateKey } from '@/lib/firmDate'

const state = vi.hoisted(() => ({ rows: [] as any[], reads: [] as any[], lookupError: null as any, readError: null as any }))
const id = '11111111-2222-3333-4444-555555555555'
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const filters: Array<(row: any) => boolean> = []
  const read: any = { table }
  const chain: any = {
    select: (columns: string, options: unknown) => { Object.assign(read, { columns, options }); return chain },
    eq: (key: string, value: string) => { filters.push(row => row[key] === value); return chain },
    in: (key: string, values: string[]) => { filters.push(row => values.includes(row[key])); return chain },
    or: (value: string) => { read.recordFilter = value; filters.push(row => value.split(',').some(clause => {
      const [key, , match] = clause.split('.'); return row[key!] === match
    })); return chain },
    lt: (key: string, value: string) => {
      read.before = value
      filters.push(row => row[key] && firmDateKey(row[key])! < value.slice(0, 10)); return chain
    },
    maybeSingle: async () => ({ data: null, error: state.lookupError }),
    then: (resolve: any, reject: any) => {
      state.reads.push(read)
      return Promise.resolve({ count: state.rows.filter(row => filters.every(filter => filter(row))).length, data: null, error: state.readError }).then(resolve, reject)
    },
  }
  return chain
} }) }))
import { fetchRecordTaskCounts } from '@/lib/queries/tasks'

beforeEach(() => { state.rows = []; state.reads = []; state.lookupError = null; state.readError = null })
describe('record task badge counts', () => {
  it('counts beyond the old 200-task limit without loading task bodies or labels', async () => {
    state.rows = Array.from({ length: 603 }, (_, index) => ({
      matter_id: id, status: ['open', 'in_progress', 'blocked'][index % 3], owner: 'firm',
      effective_due_at: index < 301 ? '2026-09-09T23:00:00Z' : '2026-09-10T12:00:00Z',
    }))
    state.rows.push(
      { matter_id: id, owner: 'client', status: 'open' },
      { matter_id: id, owner: 'firm', status: 'done' },
      { matter_id: 'another-matter', owner: 'firm', status: 'open' },
    )
    expect(await fetchRecordTaskCounts(id, new Date('2026-09-10T16:00:00Z'))).toEqual({ open: 603, overdue: 301 })
    expect(state.reads).toHaveLength(2)
    expect(state.reads.every(read => read.table === 'tasks' && read.options?.head === true && read.options?.count === 'exact')).toBe(true)
  })
  it('counts a lead-linked task once and uses the firm day, including DST', async () => {
    state.rows = [
      { matter_id: id, lead_id: id, owner: 'firm', status: 'open', effective_due_at: '2026-11-01T03:59:59Z' },
      { matter_id: id, owner: 'firm', status: 'open', effective_due_at: '2026-11-01T04:00:00Z' },
      { matter_id: id, owner: 'firm', status: 'open', effective_due_at: null },
    ]
    expect(await fetchRecordTaskCounts(id, new Date('2026-11-01T23:00:00Z'))).toEqual({ open: 3, overdue: 1 })
    expect(state.reads.find(read => read.before)?.before).toBe('2026-11-01 00:00:00 America/New_York')
  })
  it('does not turn failed identity or count reads into a zero badge', async () => {
    state.lookupError = { message: 'lookup unavailable' }
    await expect(fetchRecordTaskCounts(id)).rejects.toThrow()
    state.lookupError = null; state.readError = { message: 'count unavailable' }
    await expect(fetchRecordTaskCounts(id)).rejects.toThrow()
  })
  it('rejects malformed record IDs before interpolating a database filter', async () => {
    await expect(fetchRecordTaskCounts('bad,id')).rejects.toThrow()
    expect(state.reads).toEqual([])
  })
})
