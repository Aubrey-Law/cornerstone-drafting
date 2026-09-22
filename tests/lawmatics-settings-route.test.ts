import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), get: vi.fn(), update: vi.fn() }))
vi.mock('server-only', () => ({}))
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
  mocks.get.mockResolvedValue({ lawmaticsCustomFieldIdMap: { county: 'cf-1' } })
  mocks.update.mockResolvedValue(undefined)
})

describe('/api/admin/settings/lawmatics', () => {
  it('returns the saved mapping', async () => {
    const res = await GET(new Request('http://localhost/api/admin/settings/lawmatics'))
    await expect(res.json()).resolves.toEqual({ customFieldIdMap: { county: 'cf-1' } })
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
    await expect(res.json()).resolves.toEqual({ customFieldIdMap: { county: '123' } })
  })

  it.each([
    [{ first_name: '1' }, 'standard fields are not mappable'],
    [{ middle_name: '1' }, 'fields Lawmatics has built in are not mappable'],
    [{ matter_number: '1' }, 'matter number goes to the built-in case number'],
    [{ __proto__x: '1' }, 'unknown keys'],
    [{ county: 5 }, 'non-text IDs'],
    [{ county: 'has space' }, 'IDs with whitespace'],
  ] as Array<[Record<string, unknown>, string]>)('rejects %j (%s)', async (map) => {
    expect((await put({ customFieldIdMap: map })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects a body without a mapping object', async () => {
    expect((await put({ customFieldIdMap: ['county'] })).status).toBe(400)
  })
})
