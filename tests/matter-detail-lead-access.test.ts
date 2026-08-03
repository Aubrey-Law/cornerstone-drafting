import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const mocks = vi.hoisted(() => ({ admin: null as any }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))

import { fetchMatter } from '@/lib/queries/matterCore'

/**
 * A lead is a matter, so the matter page has to load one. Three separate places
 * filtered to `hired` on that path and each returned null on its own, which the
 * page turns into a 404 — so every one of them is pinned here.
 */

type Rows = { view?: Record<string, unknown> | null; matters?: Record<string, unknown> | null }

function harness(rows: Rows) {
  const views: string[] = []
  const admin = {
    from: vi.fn((table: string) => {
      views.push(table)
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: [], error: null }),
        order: () => chain,
        limit: () => chain,
        single: async () =>
          rows.view
            ? { data: rows.view, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } },
        maybeSingle: async () => ({ data: table === 'matters' ? rows.matters ?? null : null, error: null }),
      }
      return chain
    }),
  }
  mocks.admin = admin
  return { views }
}

const hiredRow = { matter_id: 'm1', matter_name: 'Estate Plan', client_phone: null, spouse_phone: null, flags: null }

beforeEach(() => vi.clearAllMocks())

describe('loading a matter that is still a lead', () => {
  it('reads the hired-only view by default', async () => {
    const { views } = harness({ view: hiredRow })
    await fetchMatter('m1')
    expect(views[0]).toBe('v_matter_pipeline')
  })

  it('reads the consolidated view when leads are wanted', async () => {
    const { views } = harness({ view: hiredRow })
    await fetchMatter('m1', { includeLeads: true })
    expect(views[0]).toBe('v_matter_pipeline_all')
  })

  it('still refuses a lead through the fallback when leads are not wanted', async () => {
    // The view returns nothing for a lead, so the fallback runs; it reads
    // `matters` directly and must apply the same rule the view did.
    harness({ view: null, matters: { id: 'm1', relationship_status: 'lead', client_intake_id: 'i1' } })
    expect(await fetchMatter('m1')).toBeNull()
  })

  it('does not reject a lead in the fallback when leads are wanted', async () => {
    // The regression: both gates had to agree. With only the view widened the
    // fallback still returned null and the page 404'd anyway.
    harness({ view: null, matters: { id: 'm1', relationship_status: 'lead', client_intake_id: 'i1' } })
    const result = await fetchMatter('m1', { includeLeads: true })
    expect(result).not.toBeNull()
  })

  it('the matter page asks for leads', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/page.tsx'),
      'utf8',
    )
    expect(source).toContain('fetchMatter(id, { includeLeads: true })')
    // The shell loader must not reintroduce a filter of its own.
    expect(source).not.toContain("relationship_status', 'hired'")
  })
})
