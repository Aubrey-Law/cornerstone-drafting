// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const push = vi.hoisted(() => vi.fn())
const actions = vi.hoisted(() => ({
  linkUpload: vi.fn(async () => ({ ok: true, message: 'Linked.' })),
  reviewUploadAgain: vi.fn(async () => ({ ok: true, runId: 'run-2' })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/app/admin/review/[runId]/actions', () => actions)

import { UploadPanel } from '@/app/admin/review/[runId]/UploadPanel'
import { MatterReviewsTab } from '@/app/admin/matters/[id]/MatterReviewsTab'

const props = {
  runId: 'run-1',
  reviewUploadId: 'up1',
  filed: false,
  matters: [{ matterId: 'm1', title: 'Smith Estate Plan' }],
  playbooks: [
    { slug: 'ma-trust-firm-qa', title: 'Trust review' },
    { slug: 'ma-will-firm-qa', title: 'Will review' },
  ],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('UploadPanel in Cornerstone', () => {
  it('links a linked upload’s filing hint to the matter’s Documents tab, and says a Word copy is not one to file', () => {
    const { rerender } = render(<UploadPanel {...props} linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByRole('link', { name: 'Documents tab' }).getAttribute('href')).toBe('/admin/matters/m1?tab=documents')

    rerender(<UploadPanel {...props} filed linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-filed-state').textContent).toBe("In the matter's documents.")

    rerender(<UploadPanel {...props} fromWord linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-filed-state').textContent).toBe('The copy Word had open when this review ran.')
  })

  it('queues another review with the chosen playbook and opens it under /admin/review', async () => {
    render(<UploadPanel {...props} linkedMatterId={null} linkedMatterTitle={null} />)
    fireEvent.change(screen.getByLabelText('Playbook for another review'), { target: { value: 'ma-will-firm-qa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/review/run-2'))
    expect(actions.reviewUploadAgain).toHaveBeenCalledWith('up1', 'ma-will-firm-qa')
  })

  it('says why when another review cannot be queued', async () => {
    actions.reviewUploadAgain.mockResolvedValueOnce({ ok: false, message: 'This upload has no stored text to review.' } as never)
    render(<UploadPanel {...props} linkedMatterId={null} linkedMatterTitle={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }))
    expect(await screen.findByText('This upload has no stored text to review.')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('MatterReviewsTab', () => {
  it('lists the matter’s reviews, each opening its saved review', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          reviews: [
            { runId: 'r1', matterTitle: 'Smith Estate Plan · from Word', unfiled: true, documentName: 'Smith trust draft', status: 'completed', ruleTotal: 3, findingCount: 3, failedCount: 0, finishedAt: '2026-09-26T10:01:00Z' },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<MatterReviewsTab matterId="m1" />)
    const link = await screen.findByRole('link', { name: /Smith trust draft/ })
    expect(link.getAttribute('href')).toBe('/admin/review/r1')
    expect(link.textContent).toContain('from Word')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/matters/m1/reviews')
  })

  it('says so when there are none, and when they cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reviews: [] }), { status: 200 })))
    const { unmount } = render(<MatterReviewsTab matterId="m1" />)
    expect(await screen.findByText(/No reviews yet/)).toBeTruthy()
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })))
    render(<MatterReviewsTab matterId="m1" />)
    expect(await screen.findByText('boom')).toBeTruthy()
  })
})
