// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/app/review/[runId]/actions', () => ({ linkUpload: vi.fn(async () => ({ ok: true, message: 'Linked.' })) }))

import { UploadPanel } from '@/app/review/[runId]/UploadPanel'

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
  push.mockReset()
})

describe('UploadPanel', () => {
  it('says whether the upload is linked, and what a new review will use', () => {
    const { rerender } = render(<UploadPanel {...props} linkedMatterId={null} linkedMatterTitle={null} />)
    expect(screen.getByTestId('upload-link-state')).toHaveTextContent('Not linked to a matter')
    expect(screen.getByText(/every rule runs/)).toBeInTheDocument()

    rerender(<UploadPanel {...props} linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-link-state')).toHaveTextContent('Linked to Smith Estate Plan')
    expect(screen.getByText(/linked matter's design sheet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Link to matter')).toHaveValue('m1')
  })

  it("says where to file a linked upload, and when it is already in the matter's documents", () => {
    const { rerender } = render(<UploadPanel {...props} linkedMatterId={null} linkedMatterTitle={null} />)
    expect(screen.queryByTestId('upload-filed-state')).toBeNull()

    rerender(<UploadPanel {...props} linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-filed-state')).toHaveTextContent("use Add to documents on the matter's Documents tab")

    rerender(<UploadPanel {...props} filed linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-filed-state')).toHaveTextContent("In the matter's documents.")

    // A Word snapshot is the firm's draft, never a prior plan to file.
    rerender(<UploadPanel {...props} fromWord linkedMatterId="m1" linkedMatterTitle="Smith Estate Plan" />)
    expect(screen.getByTestId('upload-filed-state')).toHaveTextContent('The copy Word had open when this review ran.')
  })

  it('queues another review of the upload with the chosen playbook and opens it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runId: 'run-2', queued: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<UploadPanel {...props} linkedMatterId={null} linkedMatterTitle={null} />)

    fireEvent.change(screen.getByLabelText('Playbook for another review'), { target: { value: 'ma-will-firm-qa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/review/run-2'))
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData
    expect(body.get('reviewUploadId')).toBe('up1')
    expect(body.get('playbookSlug')).toBe('ma-will-firm-qa')
  })
})
