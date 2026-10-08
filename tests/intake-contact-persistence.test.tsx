// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContacts } from '@/hooks/useContacts'

const mocks = vi.hoisted(() => ({ session: vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>(async () => ({ data: { session: { access_token: 'session-1' } } })), error: vi.fn() }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: mocks.session } } }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
const request = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>>(async () => ({ ok: true, json: async () => ({ ok: true }) }))
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); vi.stubGlobal('fetch', request) })
afterEach(() => vi.unstubAllGlobals())

describe('compiled contacts persistence capabilities', () => {
  it.each(['saveSpouse', 'saveChildren', 'saveAdditionalContacts', 'saveFiduciaries'] as const)('propagates %s failure in strict mode', async (method) => {
    request.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) })
    const { result } = renderHook(() => useContacts('intake-1', { throwOnError: true }))
    const save = method === 'saveSpouse' ? () => result.current.saveSpouse({ first_name: 'Jane' })
      : method === 'saveFiduciaries' ? () => result.current.saveFiduciaries([{ first_name: 'Jane', priority: 1 }], 'poa', 'client')
      : () => result.current[method]([{ first_name: 'Jane' }])
    await expect(save()).rejects.toThrow('offline')
  })
  it('retains the legacy swallowed-error default', async () => {
    request.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) })
    const { result } = renderHook(() => useContacts('intake-1'))
    await expect(result.current.saveChildren([])).resolves.toBeUndefined()
  })
  it('uses only the public token and the exact intake target', async () => {
    const { result } = renderHook(() => useContacts('intake-1', { publicIntakeToken: 'invite-1', throwOnError: true }))
    await result.current.saveChildren([{ first_name: 'Jane', last_name: 'Child' }])
    expect(request).toHaveBeenCalledWith('/api/intake/contacts', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'X-Intake-Token': 'invite-1' },
      body: JSON.stringify({ action: 'save_children', intakeId: 'intake-1', children: [{ first_name: 'Jane', last_name: 'Child' }] }),
    }))
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it('fails strict persistence when the session has expired', async () => {
    mocks.session.mockResolvedValueOnce({ data: { session: null } })
    const { result } = renderHook(() => useContacts('intake-1', { throwOnError: true }))
    await expect(result.current.saveChildren([])).rejects.toThrow(/session/i)
    expect(request).not.toHaveBeenCalled()
  })
})
