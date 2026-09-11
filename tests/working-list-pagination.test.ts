import { describe, expect, it } from 'vitest'
import { pageRequest } from '@/lib/queries/page'
import { taskPageParams } from '@/lib/tasks/pageParams'
describe('working list input validation', () => {
  it('defaults and clamps page sizes', () => {
    expect(pageRequest()).toEqual({ page: 1, pageSize: 50 })
    expect(pageRequest({ page: '2', pageSize: 500 })).toEqual({ page: 2, pageSize: 100 })
  })
  it.each([0,-1,1.5,Infinity,NaN,'nope',1e20])('rejects invalid pages: %s', page => expect(() => pageRequest({ page })).toThrow())
  it('preserves independent completion pagination and validated filters', () => {
    expect(taskPageParams({ scope:'unassigned',priority:'high',page:'4',done:'1',donePage:'2' })).toMatchObject({ scope:'unassigned', priority:'high', page:4, donePage:2, showDone:true })
    expect(() => taskPageParams({ source:'unknown' })).toThrow()
    expect(() => taskPageParams({ assignee:'x,y' })).toThrow()
  })
})

describe('invoice issue-month boundaries', () => {
  it('handles leap February and year rollover without payment-period conversion', async () => {
    const { monthRange } = await import('@/lib/queries/page')
    expect(monthRange('2024-02')).toEqual({from:'2024-02-01',to:'2024-03-01'})
    expect(monthRange('2026-12')).toEqual({from:'2026-12-01',to:'2027-01-01'})
    for (const month of ['2026-00','2026-13','2026-2','bad']) expect(()=>monthRange(month)).toThrow()
  })
})
