import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBearerUser: vi.fn(),
  isAdminUser: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  checkDocumentShareable: vi.fn(),
}))

// `after` needs a live request scope, which a unit test has no way to give it.
// Running the callback inline keeps the notification path exercised rather than
// stubbed away entirely.
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (callback: () => void) => callback() }
})
vi.mock('@/lib/apiAuth', () => ({ getBearerUser: mocks.getBearerUser }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/documentSecurity', () => ({
  isAdminUser: mocks.isAdminUser,
  userCanAccessMatter: vi.fn().mockResolvedValue(true),
  userCanReadDocument: vi.fn().mockResolvedValue(true),
  auditDocumentAccess: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({ send: vi.fn() }), r2Bucket: () => 'bucket' }))
vi.mock('@/lib/portalNotifications', () => ({ notifyClientOfSharedDocument: vi.fn() }))
vi.mock('@/lib/documents/shareGate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documents/shareGate')>(
    '@/lib/documents/shareGate',
  )
  return { ...actual, checkDocumentShareable: mocks.checkDocumentShareable }
})

import { PATCH as patchDocument } from '@/app/api/documents/[id]/route'

const DOC_ID = '33333333-3333-4333-8333-333333333333'

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) builder[method] = () => builder
  builder.update = (...args: unknown[]) => {
    mocks.update(...args)
    return builder
  }
  builder.single = async () => result
  builder.maybeSingle = async () => result
  return builder
}

const EXISTING = {
  id: DOC_ID,
  matter_id: 'm1',
  name: 'Trust.docx',
  shared_at: null,
  r2_key: 'k',
  content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  source: 'firm',
  missing_count: 0,
}

function request(body: unknown) {
  return new Request(`http://localhost/api/documents/${DOC_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBearerUser.mockResolvedValue({ id: 'user-1' })
  mocks.isAdminUser.mockResolvedValue(true)
  mocks.checkDocumentShareable.mockResolvedValue({ shareable: true })
  mocks.from.mockReturnValue(chain({ data: { ...EXISTING, shared_at: null }, error: null }))
})

describe('PATCH /api/documents/[id] share toggle', () => {
  it('shares a document that passes the gate', async () => {
    const response = await patchDocument(request({ shared: true }), {
      params: Promise.resolve({ id: DOC_ID }),
    })
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalled()
  })

  it('refuses to share a document with unfilled fields, and does not write', async () => {
    mocks.checkDocumentShareable.mockResolvedValue({
      shareable: false,
      reason: 'missing_fields',
      missingFields: ['healthcare.agent.primary.phone'],
    })

    const response = await patchDocument(request({ shared: true }), {
      params: Promise.resolve({ id: DOC_ID }),
    })

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; missingFields: string[] }
    expect(body.missingFields).toEqual(['healthcare.agent.primary.phone'])
    expect(body.error).toContain('healthcare.agent.primary.phone')
    // The gate is only worth anything if shared_at stays null.
    expect(mocks.update).not.toHaveBeenCalled()
  })

  /**
   * Unsharing is how a document that should not have gone out is pulled back.
   * Gating that would be exactly backwards — and a document already shared is
   * the one case where the check would otherwise refuse to let go of it.
   */
  it('always allows unsharing, even for a document that could not be shared now', async () => {
    mocks.checkDocumentShareable.mockResolvedValue({
      shareable: false,
      reason: 'missing_fields',
      missingFields: ['client.street_address'],
    })
    mocks.from.mockReturnValue(
      chain({ data: { ...EXISTING, shared_at: '2026-09-01T00:00:00Z' }, error: null }),
    )

    const response = await patchDocument(request({ shared: false }), {
      params: Promise.resolve({ id: DOC_ID }),
    })

    expect(response.status).toBe(200)
    expect(mocks.checkDocumentShareable).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith({ shared_at: null })
  })

  it('refuses when the document could not be checked', async () => {
    mocks.checkDocumentShareable.mockResolvedValue({
      shareable: false,
      reason: 'unverifiable',
      detail: 'NoSuchKey',
    })

    const response = await patchDocument(request({ shared: true }), {
      params: Promise.resolve({ id: DOC_ID }),
    })

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; reason: string }
    expect(body.reason).toBe('unverifiable')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  /**
   * Renaming and filing are not sharing. Making the gate cost anything on those
   * paths would be a tax on ordinary work for no safety gained.
   */
  it('does not run the gate when renaming', async () => {
    const response = await patchDocument(request({ name: 'Renamed.docx' }), {
      params: Promise.resolve({ id: DOC_ID }),
    })
    expect(response.status).toBe(200)
    expect(mocks.checkDocumentShareable).not.toHaveBeenCalled()
  })
})
