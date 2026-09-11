import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const single = vi.fn(async () => ({ data: { role: 'attorney' } }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const getClaims = vi.fn(async () => ({
    data: { claims: { sub: 'staff-user' } },
  }))

  return { single, eq, select, from, getClaims }
})

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims: mocks.getClaims },
    from: mocks.from,
  })),
}))

import { proxy } from '@/proxy'

describe('proxy role resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('defers a missing admin-page role claim to the server layout without a database lookup', async () => {
    const response = await proxy(
      new NextRequest('https://cornerstone.example/admin/billing'),
    )

    expect(response.status).toBe(200)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('continues resolving missing role claims for admin API requests', async () => {
    const response = await proxy(
      new NextRequest('https://cornerstone.example/api/admin/billing/ledger'),
    )

    expect(response.status).toBe(200)
    expect(mocks.from).toHaveBeenCalledWith('users')
  })

  it('continues rejecting unauthenticated admin page requests in the proxy', async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: {} } })

    const response = await proxy(
      new NextRequest('https://cornerstone.example/admin/billing'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://cornerstone.example/auth/login?redirectTo=%2Fadmin%2Fbilling',
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
