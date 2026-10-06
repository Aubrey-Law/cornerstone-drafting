// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIntake: vi.fn(),
  getMatter: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRecentDocuments: vi.fn(),
  fetchSharedDocuments: vi.fn(),
  fetchLatestMessage: vi.fn(),
  fetchUnreadCount: vi.fn(),
  fetchAppointment: vi.fn(),
  fetchAccount: vi.fn(),
  fetchLatestPlanStatus: vi.fn(),
  loadPlanStatusFacts: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`) }),
}))

vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => ({ id: 'portal-user' })),
  createServerSupabase: vi.fn(async () => ({ auth: {} })),
}))

vi.mock('@/lib/intake/getOrCreateClientIntake', () => ({
  findClientIntakeForUser: mocks.findIntake,
}))

vi.mock('@/lib/portal/getMatterForUser', () => ({
  getMatterForUser: mocks.getMatter,
}))

vi.mock('@/lib/queries/portal', () => ({
  fetchPortalMatterMeta: mocks.fetchMeta,
  fetchRecentPortalDocuments: mocks.fetchRecentDocuments,
  fetchSharedDocuments: mocks.fetchSharedDocuments,
  fetchLatestFirmMessage: mocks.fetchLatestMessage,
  fetchUnreadFirmMessageCount: mocks.fetchUnreadCount,
  fetchNextAppointment: mocks.fetchAppointment,
  fetchPortalAccount: mocks.fetchAccount,
  fetchOpenPortalDocumentRequests: async () => [],
}))

vi.mock('@/lib/portal/planStatusServer', () => ({
  fetchLatestPlanStatus: mocks.fetchLatestPlanStatus,
  loadPlanStatusFacts: mocks.loadPlanStatusFacts,
}))

vi.mock('@/lib/portal/signaturesServer', () => ({
  fetchPortalSignatures: async () => [],
}))

import PortalDashboardPage from '@/app/(portal)/dashboard/page'

describe('portal dashboard recorded next actions', () => {
  beforeEach(() => {
    mocks.findIntake.mockResolvedValue({ first_name: 'Morgan', status: 'submitted' })
    mocks.getMatter.mockResolvedValue({ id: 'matter-1', status: 'active', stage: 'drafting' })
    mocks.fetchMeta.mockResolvedValue(null)
    mocks.fetchRecentDocuments.mockResolvedValue([])
    mocks.fetchSharedDocuments.mockResolvedValue([])
    mocks.fetchLatestMessage.mockResolvedValue(null)
    mocks.fetchUnreadCount.mockResolvedValue(0)
    mocks.fetchAppointment.mockResolvedValue(null)
    mocks.fetchAccount.mockResolvedValue({ invoices: [], balanceCents: 0, nextDueDate: null })
    mocks.fetchLatestPlanStatus.mockResolvedValue(null)
    mocks.loadPlanStatusFacts.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders a retry state when the recent-document read fails instead of claiming the list is empty', async () => {
    mocks.fetchRecentDocuments.mockRejectedValue(new Error('documents unavailable'))

    render(await PortalDashboardPage())

    expect(screen.getByRole('alert').textContent).toContain('Documents are temporarily unavailable')
    expect(screen.getByRole('link', { name: 'Retry documents' }).getAttribute('href')).toBe('/documents')
    expect(screen.queryByText('No documents shared yet.')).toBeNull()
  })

  it('renders the submitted-intake waiting state when no owned matter exists', async () => {
    mocks.getMatter.mockResolvedValue(null)

    render(await PortalDashboardPage())

    expect(screen.getByText('Your intake has been submitted. The firm will contact you about the next step.')).toBeTruthy()
    expect(screen.queryByText(/No new action is listed for you right now/)).toBeNull()
    expect(mocks.fetchRecentDocuments).not.toHaveBeenCalled()
    expect(mocks.fetchSharedDocuments).not.toHaveBeenCalled()
  })
})
