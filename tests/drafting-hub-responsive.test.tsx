// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { PipelineMatter } from '@/types/database'

const router = vi.hoisted(() => ({
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

import DraftingHubClient from '@/app/admin/drafting/DraftingHubClient'

const matter: DraftingHubMatter = {
  matter: {
    matter_id: 'matter-1',
    matter_name: 'Doe Family Trust',
    client_name: 'Jane Doe',
    spouse_name: 'John Doe',
    client_email: 'jane@example.com',
    practice_area: 'Estate Planning',
    plan_type: 'Revocable Trust',
    stage: 'drafting',
    matter_created: '2026-08-01T12:00:00.000Z',
  } as PipelineMatter,
  matterNumber: '2026-EP-001',
  setupBlockers: [],
  designSheet: {
    id: 'design-1',
    status: 'approved',
    version: 2,
    updatedAt: '2026-08-10T12:00:00.000Z',
  },
  documentInclusions: null,
  includedDocumentLabels: ['Revocable Trust', 'Pour-Over Will'],
  selectedTemplateCount: 2,
  selectedTemplates: ['trust', 'will'],
  draftCount: 3,
  recentDrafts: [{
    id: 'draft-1',
    name: 'Trust.docx',
    size: 1024,
    created_at: '2026-08-12T12:00:00.000Z',
    generationId: 'generation-1',
    generationEngine: 'docxtemplater',
    markerCount: 0,
    missingCount: 0,
    supersededAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }],
  supersededDrafts: [],
  supersededDraftCount: 0,
}

const secondMatter: DraftingHubMatter = {
  ...matter,
  matter: {
    ...matter.matter,
    matter_id: 'matter-2',
    matter_name: 'Smith Estate Plan',
    client_name: 'Alex Smith',
    spouse_name: null,
    client_email: 'alex@example.com',
  },
  matterNumber: '2026-EP-002',
  recentDrafts: [{
    ...matter.recentDrafts[0],
    id: 'draft-2',
    created_at: '2026-08-11T12:00:00.000Z',
  }],
}

afterEach(() => {
  cleanup()
  router.push.mockReset()
  router.prefetch.mockReset()
  router.refresh.mockReset()
  vi.useRealTimers()
})

describe('drafting hub responsive matter list', () => {
  it('offers a complete tappable mobile card while retaining the desktop table', async () => {
    const user = userEvent.setup()
    render(<DraftingHubClient matters={[matter]} />)

    const mobileList = screen.getByRole('list', { name: 'Drafting matters' })
    const card = within(mobileList).getByRole('button', {
      name: /Open drafting:.*Jane Doe.*John Doe.*2026-EP-001.*Review & share.*3 current drafts.*Documents.*2.*Drafts.*3.*Activity.*Practice.*Estate Planning/i,
    })

    expect(within(card).getByText('John Doe', { exact: false })).toBeTruthy()
    expect(within(card).getByText('2026-EP-001', { exact: false })).toBeTruthy()
    expect(within(card).getByText('Review & share')).toBeTruthy()
    expect(within(card).getByText('3 current drafts')).toBeTruthy()
    expect(within(card).getByText('2', { selector: '[data-value="documents"]' })).toBeTruthy()
    expect(within(card).getByText('3', { selector: '[data-value="drafts"]' })).toBeTruthy()
    expect(within(card).getByText('Estate Planning')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Drafting matters table' })
    const tableSurface = table.parentElement?.parentElement
    const search = screen.getByRole('searchbox', { name: 'Search matters' })
    const filters = screen.getByRole('group', { name: 'Next action filter' })

    expect(mobileList.className).toContain('md:hidden')
    expect(tableSurface?.className).toContain('hidden')
    expect(tableSurface?.className).toContain('md:block')
    expect(search.parentElement?.className).toContain('w-full')
    expect(filters.className).toContain('overflow-x-auto')
    expect(filters.className).toContain('sm:overflow-visible')

    card.focus()
    await user.keyboard('{Enter}')
    card.blur()

    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/admin/drafting/matter-1')
  })

  it('preserves slash search and arrow navigation when a mobile card has focus', async () => {
    const user = userEvent.setup()
    render(<DraftingHubClient matters={[secondMatter, matter]} />)

    const cards = within(screen.getByRole('list', { name: 'Drafting matters' })).getAllByRole('button')
    cards[0].focus()

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cards[1])

    await user.keyboard('{Enter}')
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/admin/drafting/matter-2')

    await user.keyboard('/')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search matters' }))
  })

  it('debounces card prefetch and cancels it when focus leaves', async () => {
    vi.useFakeTimers()
    render(<DraftingHubClient matters={[matter, secondMatter]} />)

    const cards = within(screen.getByRole('list', { name: 'Drafting matters' })).getAllByRole('button')
    fireEvent.mouseEnter(cards[0])
    await vi.advanceTimersByTimeAsync(99)
    expect(router.prefetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(router.prefetch).toHaveBeenCalledTimes(1)
    expect(router.prefetch).toHaveBeenCalledWith('/admin/drafting/matter-1')

    fireEvent.focus(cards[1])
    fireEvent.blur(cards[1])
    await vi.advanceTimersByTimeAsync(100)
    expect(router.prefetch).toHaveBeenCalledTimes(1)
  })
})
