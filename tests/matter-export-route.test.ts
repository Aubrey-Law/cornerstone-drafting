import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { filterAndSortMatters, type MatterSortKey } from '@/lib/adminTables/matterTable'
import type { StageGroup } from '@/types/database'

/**
 * Route/export wiring uses a reference filtering fixture at the RPC seam.
 * Actual SQL filtering and board completeness are verified by the local
 * matter-list-pagination integration tests.
 */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  tableResult: {} as Record<string, { data: unknown[]; error: { message: string } | null }>,
  queried: [] as string[],
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/matter/unreviewedUploads', () => ({
  fetchUnreviewedUploadCountsForMatters: async () => new Map(),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    async rpc(name: string, { p_query: query }: { p_query: { search:string; practice:string; stage:StageGroup|'all'; sort:MatterSortKey; page:number; pageSize:number } }) {
      mocks.queried.push(name)
      const result=mocks.tableResult.v_matter_pipeline
      if(result.error) return {data:null,error:result.error}
      const selected=filterAndSortMatters(result.data as MatterListRow[],{search:query.search,practice:query.practice,stageGroup:query.stage},query.sort)
      return {data:{rows:selected.slice((query.page-1)*query.pageSize,query.page*query.pageSize),total:selected.length,page:query.page,pageSize:query.pageSize,groups:{},columns:{},insights:{}},error:null}
    },
    from(table: string) {
      mocks.queried.push(table)
      const result = mocks.tableResult[table] ?? { data: [], error: null }
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      for (const method of ['select', 'neq', 'eq', 'in', 'order']) {
        chain[method] = () => chain
      }
      return chain
    },
  }),
}))

import { GET } from '@/app/api/admin/matters/export/route'
import { MATTER_EXPORT_HEADERS } from '@/lib/matters/exportRows'
import type { MatterListRow } from '@/lib/queries/matters'

function matter(fields: Partial<MatterListRow> = {}): MatterListRow {
  return {
    matter_id: 'm1',
    matter_name: 'Smith Family Trust',
    stage: 'design',
    status: 'open',
    flags: null,
    matter_created: '2026-06-01T00:00:00.000Z',
    client_name: 'Sam Smith',
    client_email: 'sam@example.com',
    client_phone: '617-555-0100',
    client_dob: null,
    client_address: null,
    spouse_name: null,
    spouse_email: null,
    spouse_phone: null,
    spouse_dob: null,
    spouse_address: null,
    plan_type: null,
    marital_status: null,
    has_minor_children: null,
    taxable_estate: null,
    intake_status: null,
    design_status: null,
    intake_submitted_at: null,
    drafts_sent_at: null,
    signing_date: null,
    documents_executed_at: null,
    next_appointment: null,
    next_appointment_type: null,
    referral_source: null,
    fee_amount: null,
    opened_at: null,
    matter_number: '2026-EP-Smith',
    ...fields,
  }
}

const MATTERS = [
  matter(),
  matter({
    matter_id: 'm2',
    client_name: 'Dana Lee',
    matter_name: 'Lee Trust',
    client_email: 'dana@example.com',
    matter_number: '2026-EP-Lee',
    stage: 'signing_scheduled',
  }),
]

describe('the matters export route', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset()
    mocks.queried.length = 0
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'admin-1', user: null })
    mocks.tableResult = {
      v_matter_pipeline: { data: MATTERS, error: null },
      matters: {
        data: MATTERS.map(row => ({ id: row.matter_id, matter_number: row.matter_number })),
        error: null,
      },
    }
  })

  it('is admin-only — client data never leaves on an unauthenticated request', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })
    const response = await GET(new Request('https://app.test/api/admin/matters/export'))
    expect(response.status).toBe(401)
    expect(mocks.queried).toEqual([])
  })

  it('returns the matters list as a downloadable CSV', async () => {
    const response = await GET(new Request('https://app.test/api/admin/matters/export'))

    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="cornerstone-matters-all-')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const lines = (await response.text()).split('\n')
    expect(lines[0]).toBe(MATTER_EXPORT_HEADERS.join(','))
    // client_asc by default: Dana before Sam.
    expect(lines[1]).toContain('Dana Lee')
    expect(lines[2]).toContain('Sam Smith')
  })

  it('narrows by the same search the list uses', async () => {
    const response = await GET(new Request('https://app.test/api/admin/matters/export?search=Dana'))
    const body = await response.text()
    expect(body).toContain('Dana Lee')
    expect(body).not.toContain('Sam Smith')
  })

  it('narrows by stage group', async () => {
    const response = await GET(new Request('https://app.test/api/admin/matters/export?stage=done'))
    const body = await response.text()
    // "signing" is in the done group; "design" is not.
    expect(body).toContain('Lee Trust')
    expect(body).not.toContain('Smith Family Trust')
  })

  it('answers format=json with the export rows', async () => {
    const response = await GET(new Request('https://app.test/api/admin/matters/export?format=json&search=Dana'))
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.truncated).toBe(false)
    expect(body.matters[0]).toMatchObject({ client: 'Dana Lee', matterNumber: '2026-EP-Lee' })
  })

  it('reports a failed read rather than downloading an empty file', async () => {
    mocks.tableResult.v_matter_pipeline = { data: [], error: { message: 'pipeline view missing' } }
    const response = await GET(new Request('https://app.test/api/admin/matters/export'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Matter list is temporarily unavailable. Please retry.' })
  })
})
