import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The dashboard used to count the first 500 contacts and present the result as
 * the firm's whole book. At 221 contacts — and several more with every new
 * matter, since the contact sync writes a row per spouse, child and fiduciary
 * — that was on its way to becoming a sample nothing in the UI admitted to.
 *
 * The read pages instead. These cover the paging itself: that it asks for
 * every page, stops at the first short one, orders so the pages partition the
 * table rather than overlapping it, and reports rather than hides the ceiling.
 */

type Range = { from: number; to: number }

const ranges: Range[] = []
const orders: Array<{ column: string; ascending: boolean }> = []
let table: Array<Record<string, unknown>> = []
let failure: string | null = null
/** A server-side cap on rows per request, which PostgREST can impose. */
let serverRowCap = Number.POSITIVE_INFINITY
/** Whether the count comes back at all — a stale or absent count must not hang. */
let reportCount = true

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => {
      let wantsCount = false
      const builder = {
        select: (_columns: string, options?: { count?: string }) => {
          wantsCount = options?.count === 'exact'
          return builder
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          orders.push({ column, ascending: options?.ascending !== false })
          return builder
        },
        range: async (from: number, to: number) => {
          ranges.push({ from, to })
          if (failure) return { data: null, error: { message: failure } }
          const asked = to - from + 1
          const data = table.slice(from, from + Math.min(asked, serverRowCap))
          return {
            data,
            error: null,
            count: wantsCount && reportCount ? table.length : null,
          }
        },
      }
      return builder
    },
  }),
}))

import { CRM_DASHBOARD_MAX_PEOPLE, fetchCrmDashboardPeople } from '@/lib/queries/cornerstoneCrm'

function contacts(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    person_kind: index % 3 === 0 ? 'primary' : 'related',
    lifecycle_status: null,
    stage_id: null,
    lead_source: 'referral',
    referral_source: null,
    next_follow_up_at: null,
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
  }))
}

beforeEach(() => {
  ranges.length = 0
  orders.length = 0
  table = []
  failure = null
  serverRowCap = Number.POSITIVE_INFINITY
  reportCount = true
})

describe('the CRM dashboard contact read', () => {
  it('returns a book smaller than one page in a single request', async () => {
    table = contacts(221)
    const result = await fetchCrmDashboardPeople()

    expect(result.people.length).toBe(221)
    expect(result.truncated).toBe(false)
    expect(ranges).toEqual([{ from: 0, to: 999 }])
  })

  it('keeps asking while each page comes back full', async () => {
    table = contacts(2400)
    const result = await fetchCrmDashboardPeople()

    expect(result.people.length).toBe(2400)
    expect(result.truncated).toBe(false)
    expect(ranges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ])
  })

  it('stops exactly on a page boundary without a wasted request', async () => {
    table = contacts(2000)
    const result = await fetchCrmDashboardPeople()

    // The count came back with the first page, so a book of exactly 2,000 ends
    // after two requests rather than needing a third to prove it is over.
    expect(ranges.length).toBe(2)
    expect(result.people.length).toBe(2000)
    expect(result.truncated).toBe(false)
  })

  it('finishes the book when the server caps rows below what was asked for', async () => {
    // PostgREST can be configured with a max-rows lower than the page size.
    // Inferring the end from a short page would stop here at 400 of 900 and
    // call it the whole book.
    table = contacts(900)
    serverRowCap = 400
    const result = await fetchCrmDashboardPeople()

    expect(result.people.length).toBe(900)
    expect(result.truncated).toBe(false)
    expect(ranges.map(range => range.from)).toEqual([0, 400, 800])
  })

  it('ends on an empty page even if the count disagrees', async () => {
    table = contacts(1500)
    reportCount = false
    const result = await fetchCrmDashboardPeople()

    expect(result.people.length).toBe(1500)
    expect(result.truncated).toBe(false)
  })

  it('orders on a unique pair, so pages partition rather than overlap', async () => {
    table = contacts(10)
    await fetchCrmDashboardPeople()

    // created_at is not unique — two contacts synced together share it — so an
    // order on it alone lets a row appear on two pages or on none.
    expect(orders.slice(0, 2)).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: true },
    ])
  })

  it('reports reaching the ceiling instead of presenting a sample as a total', async () => {
    table = contacts(CRM_DASHBOARD_MAX_PEOPLE + 500)
    const result = await fetchCrmDashboardPeople()

    expect(result.people.length).toBe(CRM_DASHBOARD_MAX_PEOPLE)
    expect(result.truncated).toBe(true)
  })

  it('surfaces a failed page as an error rather than as an empty book', async () => {
    table = contacts(50)
    failure = 'connection reset'
    const result = await fetchCrmDashboardPeople()

    expect(result.error).toBe('connection reset')
    expect(result.people).toEqual([])
    // Nothing is claimed about size when the read failed.
    expect(result.truncated).toBe(false)
  })
})

describe('the CRM dashboard page', () => {
  const read = (file: string) => fs.readFileSync(file, 'utf8')

  it('counts the whole book but reads only eight enriched rows for the table', () => {
    const loader = read('lib/queries/crmDashboard.ts')
    expect(loader).toContain('fetchCrmDashboardPeople()')
    expect(loader).toContain("fetchCrmPeople(RECENT_PEOPLE, { orderBy: 'created_at' })")
    // The table is "recent people", which is created order — the default read
    // is by updated_at, which would put an edited old contact at the top.
    expect(loader).toContain('recent: recentResult.people')
  })

  it('says so on the page when the counts are a sample', () => {
    const page = read('app/admin/overview/FirmDashboardView.tsx')
    expect(page).toContain('truncated')
    expect(page).toMatch(/sample rather than a total/)
  })

  it('has no dead 5,000-row reader left to come back', () => {
    // `crmOperations.ts` and `CrmActionQueue.tsx` were unreferenced: nothing
    // rendered the queue, so its limits never ran. Deleted rather than fixed.
    expect(fs.existsSync('lib/queries/crmOperations.ts')).toBe(false)
    expect(fs.existsSync('app/admin/crm/CrmActionQueue.tsx')).toBe(false)
  })
})
