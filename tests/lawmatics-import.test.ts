import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matterToIntake, normalizeLawmaticsMaritalStatus } from '@/lib/lawmatics'
import { GET, POST } from '@/app/api/lawmatics/pull/route'

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn(), importMatter: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/lawmatics/importMatter', () => ({ importMatterFromLawmaticsProspect: mocks.importMatter }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  mocks.maybeSingle.mockResolvedValue({ data: { access_token: 'stored-token' }, error: null })
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'staff-id' })
})
afterEach(() => vi.unstubAllGlobals())

const searchRequest = () => new Request('https://example.com/api/lawmatics/pull?q=jane')
const importRequest = () => new Request('https://example.com/api/lawmatics/pull', {
  method: 'POST', body: JSON.stringify({ lm_id: 'prospect-1', target: 'lead' }),
})

describe('Lawmatics import', () => {
  it('maps Lawmatics marital statuses to client_intake-safe values', () => {
    expect(normalizeLawmaticsMaritalStatus('Married')).toBe('married')
    expect(normalizeLawmaticsMaritalStatus('DOMESTIC_PARTNERSHIP')).toBe('domestic_partner')
    expect(normalizeLawmaticsMaritalStatus('Domestic Partner')).toBe('domestic_partner')
    expect(normalizeLawmaticsMaritalStatus('Separated')).toBe('separated')
    expect(normalizeLawmaticsMaritalStatus('unknown')).toBeNull()
  })

  it('preserves intake mapping and provider identity', () => {
    expect(matterToIntake({ id: 'prospect-1', attributes: {
      first_name: 'Jane', last_name: 'Doe', marital_status: 'Married', email: 'jane@example.com',
    } })).toMatchObject({
      lawmatics_matter_id: 'prospect-1', full_name: 'Jane Doe', marital_status: 'married',
      email: 'jane@example.com', status: 'in_progress',
    })
  })

  it('searches prospects using the stored token', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      data: [{ id: 'prospect-1', attributes: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' } }],
      meta: { total_pages: 1 },
    }))
    expect(await (await GET(searchRequest())).json()).toEqual({ matches: [{
      lm_id: 'prospect-1', full_name: 'Jane Doe', email: 'jane@example.com', phone: null,
    }] })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/prospects?'), {
      headers: { Authorization: 'Bearer stored-token' },
    })
  })

  it('imports the selected prospect with the requested target and staff identity', async () => {
    mocks.importMatter.mockResolvedValue({ matterId: null, leadId: 'lead-1', created: true })
    expect(await (await POST(importRequest())).json()).toEqual({
      ok: true, matterId: null, leadId: 'lead-1', created: true,
    })
    expect(mocks.importMatter).toHaveBeenCalledWith(expect.any(Object), 'stored-token', 'prospect-1', 'staff-id', 'lead')
  })

  it.each([['search', GET, searchRequest], ['import', POST, importRequest]] as const)(
    'preserves the disconnected response for %s', async (_name, route, request) => {
      mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
      const response = await route(request())
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Lawmatics not connected — reconnect in the Import dialog' })
      expect(fetch).not.toHaveBeenCalled()
      expect(mocks.importMatter).not.toHaveBeenCalled()
    },
  )

  it('does not expose raw search errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('stored-token', { status: 502 }))
    const response = await GET(searchRequest())
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Lawmatics search failed' })
  })

  it('does not expose raw import errors', async () => {
    mocks.importMatter.mockRejectedValue(new Error('stored-token'))
    const response = await POST(importRequest())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Import failed' })
  })
})
