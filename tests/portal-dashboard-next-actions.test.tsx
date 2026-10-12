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

vi.mock('@/lib/funding/portalServer', () => ({
  fetchPortalAssets: async () => [],
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

  it('tells one story when drafting has started but the questionnaire is still open', async () => {
    mocks.findIntake.mockResolvedValue({ first_name: 'Morgan', status: 'draft' })
    mocks.getMatter.mockResolvedValue({ id: 'matter-1', status: 'active', stage: 'drafting' })
    mocks.fetchMeta.mockResolvedValue({
      matterName: 'Morgan plan',
      createdAt: '2026-09-01T00:00:00Z',
      progress: {
        heading: 'Your estate plan',
        nextAction: null,
        milestones: [
          { key: 'intake', label: 'Intake received', state: 'pending' },
          { key: 'drafts', label: 'Drafts sent', state: 'completed' },
          { key: 'review', label: 'Drafts approved', state: 'pending' },
          { key: 'signing', label: 'Documents signed', state: 'pending' },
        ],
      },
    })
    mocks.loadPlanStatusFacts.mockResolvedValue({
      matter: { id: 'matter-1', stage: 'drafting', status: 'active' },
      facts: {
        stage: 'drafting',
        stageLabel: 'Drafting',
        track: 'estate-planning',
        milestones: [
          { key: 'intake', label: 'Intake received', state: 'pending' },
          { key: 'drafts', label: 'Drafts sent', state: 'completed' },
        ],
        nextAppointment: null,
        funding: null,
        clientFollowUp: [],
        stageChangedAt: null,
        firmName: 'Aubrey Law',
        attorneyShortName: 'Scott',
      },
    })

    render(await PortalDashboardPage())

    const status = screen.getByTestId('plan-status').textContent ?? ''
    expect(status).toContain('working from what we have')
    expect(status).toContain('questionnaire is still open')
    expect(status.toLowerCase()).not.toContain('settled')
    expect(status.toLowerCase()).not.toContain('being drafted')
    expect(screen.getByText(/Finish your intake questionnaire/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue intake' }).getAttribute('href')).toBe('/intake')
    expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Intake received')
    expect(screen.getByText(/Questions\? Reach us directly/)).toBeTruthy()
  })

  it('keeps the drafting sentence once intake is complete', async () => {
    mocks.loadPlanStatusFacts.mockResolvedValue({
      matter: { id: 'matter-1', stage: 'drafting', status: 'active' },
      facts: {
        stage: 'drafting',
        stageLabel: 'Drafting',
        track: 'estate-planning',
        milestones: [
          { key: 'intake', label: 'Intake received', state: 'completed' },
          { key: 'drafts', label: 'Drafts sent', state: 'pending' },
        ],
        nextAppointment: null,
        funding: null,
        clientFollowUp: [],
        stageChangedAt: null,
        firmName: 'Aubrey Law',
        attorneyShortName: 'Scott',
      },
    })

    render(await PortalDashboardPage())

    const status = screen.getByTestId('plan-status').textContent ?? ''
    expect(status).toContain('being drafted')
    expect(status).toContain('design we settled on')
    expect(screen.queryByRole('link', { name: 'Continue intake' })).toBeNull()
    expect(screen.getByText(/No new action is listed for you right now/)).toBeTruthy()
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
