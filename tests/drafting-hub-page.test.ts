import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ claims: vi.fn(), role: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/supabaseServer', () => ({ getCachedClaims: mocks.claims, getCachedUserRole: mocks.role }))
vi.mock('@/lib/queries/drafting', () => ({ fetchDraftingHubMatters: mocks.fetch }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect') } }))
vi.mock('@/app/admin/drafting/DraftingHubClient', () => ({ default: () => null }))
import DraftingPage from '@/app/admin/drafting/page'

beforeEach(() => { vi.clearAllMocks(); mocks.claims.mockResolvedValue({ id: 'user' }); mocks.role.mockResolvedValue('attorney') })
describe('hub page authorization', () => {
  it('does not run a service-role query for an unauthenticated viewer', async () => {
    mocks.claims.mockResolvedValue(null)
    await expect(DraftingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not run a service-role query for a client', async () => {
    mocks.role.mockResolvedValue('client')
    await expect(DraftingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('forwards the normalized URL contract and canonical server page for staff', async () => {
    mocks.fetch.mockResolvedValue({ page: 2 })
    const result = await DraftingPage({ searchParams: Promise.resolve({ search: 'Jane', page: '99', action: 'review', sort: 'bad' }) })
    expect(mocks.fetch).toHaveBeenCalledWith({ search: 'Jane', page: 99, action: 'review', sort: 'updated', practice: 'all' })
    expect(result.props.query.page).toBe(2)
  })
})
