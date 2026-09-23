import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), get: vi.fn(), update: vi.fn(), leadSources: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => {
      const q = { select: () => q, not: () => q, limit: async () => ({ data: mocks.leadSources, error: null }) }
      return q
    },
  }),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/integrations/settings', () => ({
  getIntegrationSettings: mocks.get, updateIntegrationSettings: mocks.update,
}))
import { GET, PUT } from '@/app/api/admin/settings/lawmatics/route'

function put(body: unknown) {
  return PUT(new Request('http://localhost/api/admin/settings/lawmatics', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'staff-1' })
  let stored = {
    lawmaticsCustomFieldIdMap: { county: '621072' } as Record<string, string>,
    lawmaticsOptionIdMap: { practice_area: {}, source: {}, campaign: {} } as Record<string, Record<string, string>>,
  }
  mocks.leadSources = []
  mocks.get.mockImplementation(async () => stored)
  mocks.update.mockImplementation(async (patch: Partial<typeof stored>) => { stored = { ...stored, ...patch } })
})

describe('/api/admin/settings/lawmatics', () => {
  it('returns the saved mapping', async () => {
    const res = await GET(new Request('http://localhost/api/admin/settings/lawmatics'))
    await expect(res.json()).resolves.toMatchObject({ customFieldIdMap: { county: '621072' } })
  })

  it('rejects unauthenticated requests', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: Response.json({ error: 'Unauthorized' }, { status: 401 }), userId: null })
    expect((await put({ customFieldIdMap: {} })).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('saves trimmed IDs and drops blank ones', async () => {
    const res = await put({ customFieldIdMap: { county: ' 123 ', spouse_email: '', children: null } })

    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ lawmaticsCustomFieldIdMap: { county: '123' } }, 'staff-1')
    await expect(res.json()).resolves.toMatchObject({ customFieldIdMap: { county: '123' } })
  })

  it('stores the number from a pasted merge field', async () => {
    const res = await put({ customFieldIdMap: { county: '{{custom_field_621072}}', children: 'custom_field_244367' } })
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ lawmaticsCustomFieldIdMap: { county: '621072', children: '244367' } }, 'staff-1')
  })

  it.each([
    [{ first_name: '1' }, 'standard fields are not mappable'],
    [{ middle_name: '1' }, 'fields Lawmatics has built in are not mappable'],
    [{ matter_number: '1' }, 'matter number goes to the built-in case number'],
    [{ __proto__x: '1' }, 'unknown keys'],
    [{ county: 5 }, 'non-text IDs'],
    [{ county: 'has space' }, 'IDs with whitespace'],
    [{ practice_area: 'practice_area' }, 'a built-in merge field name instead of an ID'],
  ] as Array<[Record<string, unknown>, string]>)('rejects %j (%s)', async (map) => {
    expect((await put({ customFieldIdMap: map })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects a body without a mapping object', async () => {
    expect((await put({ customFieldIdMap: ['county'] })).status).toBe(400)
  })
})

describe('/api/admin/settings/lawmatics picklists', () => {
  it('lists distinct lead sources, keyed the way the push looks them up', async () => {
    mocks.leadSources = [
      { lead_source: 'Google Ads' }, { lead_source: ' google  ads ' }, { lead_source: 'google ads' },
      { lead_source: 'Referral' }, { lead_source: '   ' },
    ]
    const res = await GET(new Request('http://localhost/api/admin/settings/lawmatics'))
    const body = await res.json()
    expect(body.leadSources).toEqual([
      { key: 'google ads', label: 'google ads', count: 3 },
      { key: 'referral', label: 'Referral', count: 1 },
    ])
    expect(body.optionIdMap).toEqual({ practice_area: {}, source: {}, campaign: {} })
  })

  it('saves the option map without touching the custom field map', async () => {
    const res = await put({ optionIdMap: {
      practice_area: { EP: ' 11 ', CP: '' },
      source: { 'Google Ads': '21' },
      campaign: { referral: '31' },
    } })

    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ lawmaticsOptionIdMap: {
      practice_area: { EP: '11' }, source: { 'google ads': '21' }, campaign: { referral: '31' },
    } }, 'staff-1')
    await expect(res.json()).resolves.toMatchObject({ customFieldIdMap: { county: '621072' } })
  })

  it.each([
    [{ practice_area: { XX: '1' } }, 'an unknown practice area'],
    [{ stage: { EP: '1' } }, 'an unknown picklist'],
    [{ source: { Google: 'abc' } }, 'a non-numeric ID'],
  ] as Array<[Record<string, unknown>, string]>)('rejects %j (%s)', async (map) => {
    expect((await put({ optionIdMap: map })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
