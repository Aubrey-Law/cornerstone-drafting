import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  sync: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/integrations/statular/clients', () => ({ syncStatularClient: mocks.sync }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}))

import { POST } from '@/app/api/statular/push/route'

const intakeId = '11111111-2222-4333-8444-555555555555'

function request(body: unknown) {
  return new Request('http://localhost/api/statular/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function failure(kind: 'attention' | 'retryable', code: string) {
  return new IntegrationError({ provider: 'statular', kind, code, safeMessage: `Safe ${code}.`, retryAfterMs: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'user-1' })
  mocks.insert.mockResolvedValue({ error: null })
  mocks.sync.mockResolvedValue({ provider: 'statular', externalRecordType: 'client', externalId: '987', operation: 'created' })
})

describe('POST /api/statular/push', () => {
  it('requires staff auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    const response = await POST(request({ intakeId }))

    expect(response.status).toBe(403)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it.each([{}, { intakeId: 'not-a-uuid' }, { intakeId: 42 }])('rejects an invalid intake id %j', async body => {
    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('creates the client and records it on the lead timeline', async () => {
    const response = await POST(request({ intakeId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ statularClientId: '987', operation: 'created' })
    expect(mocks.sync).toHaveBeenCalledWith(intakeId)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: intakeId, event_type: 'statular_pushed', title: 'Created in Statular', actor_id: 'user-1',
    }))
  })

  it('reports an existing link without logging a second creation', async () => {
    mocks.sync.mockResolvedValue({ provider: 'statular', externalRecordType: 'client', externalId: '987', operation: 'reused' })

    const response = await POST(request({ intakeId }))

    await expect(response.json()).resolves.toEqual({ statularClientId: '987', operation: 'reused' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['attention', 'configuration_required', 503],
    ['attention', 'invalid_source_data', 422],
    ['attention', 'validation_failed', 422],
    ['retryable', 'rate_limited', 429],
    ['retryable', 'idempotency_conflict', 409],
    ['retryable', 'network_error', 503],
    ['attention', 'permission_denied', 502],
  ] as const)('maps %s %s to %i with only the safe message', async (kind, code, status) => {
    mocks.sync.mockRejectedValue(failure(kind, code))

    const response = await POST(request({ intakeId }))

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: `Safe ${code}.`, code })
  })

  it('hides unexpected failure detail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sync.mockRejectedValue(new Error('PRIVATE https://api.statular.com/webhooks/v1/stat_whk_secret'))

    const response = await POST(request({ intakeId }))

    expect(response.status).toBe(500)
    const output = JSON.stringify(await response.json()) + JSON.stringify(log.mock.calls)
    expect(output).not.toMatch(/PRIVATE|stat_whk_/)
    log.mockRestore()
  })
})
