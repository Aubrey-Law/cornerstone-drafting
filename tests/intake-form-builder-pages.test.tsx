// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ claims: vi.fn(), role: vi.fn(), list: vi.fn(), notFound: vi.fn() }))
vi.mock('@/lib/supabaseServer', () => ({ getCachedClaims: mocks.claims, getCachedUserRole: mocks.role }))
vi.mock('@/lib/intake/forms/adminService', () => ({ listIntakeFormTemplateSummaries: mocks.list }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: vi.fn() }) }))
import IntakeFormsPage from '@/app/admin/settings/intake-forms/page'

describe('intake form list server authorization', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claims.mockResolvedValue({ id: 'admin-1' })
    mocks.role.mockResolvedValue('admin')
    mocks.list.mockResolvedValue([])
    mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
  })

  it('loads templates for an authenticated administrator', async () => {
    render(await IntakeFormsPage())
    expect(screen.getByRole('heading', { name: 'Intake forms' })).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it.each(['attorney', 'client', null])('rejects role %s before reading templates', async role => {
    mocks.role.mockResolvedValue(role)
    await expect(IntakeFormsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rejects absent authentication even if a stale role mock is administrator', async () => {
    mocks.claims.mockResolvedValue(null)
    await expect(IntakeFormsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('offers a retry link on loader failure without rendering an empty list', async () => {
    mocks.list.mockRejectedValue(new Error('database unavailable'))
    render(await IntakeFormsPage())
    expect(screen.getByRole('alert').textContent).toContain('Could not load intake forms')
    expect(screen.getByRole('link', { name: 'Retry loading intake forms' }).getAttribute('href')).toBe('/admin/settings/intake-forms')
    expect(screen.queryByText('No intake forms yet')).toBeNull()
  })
})
