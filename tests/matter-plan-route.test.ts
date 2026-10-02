import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), admin: null as unknown }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('@/lib/slaTasks/queries', () => ({ fetchMatterPlan: vi.fn(async () => []) }))

import { GET } from '@/app/api/matters/[matterId]/tasks/route'

/**
 * The plan's key dates and fit decision, as the Tasks tab reloads them after
 * every save.
 *
 * This read asked `matters` for a client_name column it does not have. The
 * real database rejects the whole select; the route dropped the error and
 * answered with every anchor null — so a fit decision that had saved showed
 * "Not decided" again the moment the plan reloaded. The mock rejects unknown
 * columns the way PostgREST does, which is what the earlier code never met.
 */

const MATTER = '11111111-1111-4111-8111-111111111111'
const MATTERS_COLUMNS = new Set([
  'id', 'name', 'discovery_call_at', 'pmps_at', 'recommendations_sent_at', 'engagement_signed_at', 'fit_decision',
])

function client() {
  return {
    from(table: string) {
      let columns = ''
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => { columns = cols; return chain }
      chain.eq = () => chain
      chain.maybeSingle = async () => {
        if (table === 'matters') {
          const unknown = columns.split(',').map(c => c.trim()).filter(c => !MATTERS_COLUMNS.has(c))
          if (unknown.length > 0) return { data: null, error: { message: `column matters.${unknown[0]} does not exist` } }
          return {
            data: { id: MATTER, name: 'Whitfield — Estate Planning', discovery_call_at: '2026-09-01T12:00:00Z', pmps_at: null, recommendations_sent_at: null, engagement_signed_at: null, fit_decision: 'fit' },
            error: null,
          }
        }
        if (table === 'v_matter_pipeline') return { data: { client_name: 'Margaret Whitfield' }, error: null }
        return { data: null, error: null }
      }
      return chain
    },
  }
}

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ err: null })
  mocks.admin = client()
})

const get = () => GET(new Request(`http://test/api/matters/${MATTER}/tasks`), { params: Promise.resolve({ matterId: MATTER }) })

describe('the plan read', () => {
  it('returns the fit decision that was saved', async () => {
    const body = await (await get()).json()
    expect(body.anchors.fitDecision).toBe('fit')
    expect(body.anchors.discoveryCallAt).toBe('2026-09-01')
  })

  it('names the client from the pipeline view', async () => {
    expect((await (await get()).json()).matter.name).toBe('Margaret Whitfield')
  })
})
