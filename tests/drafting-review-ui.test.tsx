// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DraftingHubDocument, DraftingHubMatter } from '@/lib/queries/drafting'
const mocks = vi.hoisted(() => ({ review: vi.fn(), share: vi.fn(), refresh: vi.fn(), fetch: vi.fn(), revision: 'revision:trust' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('next/dynamic', () => ({ default: () => function Viewer(props: { documentId: string; onRevisionLoaded?: (id: string, revision: string) => void }) { return <button onClick={() => props.onRevisionLoaded?.(props.documentId, props.documentId === 'trust' ? mocks.revision : `revision:${props.documentId}`)}>Load version {props.documentId}</button> } }))
vi.mock('@/components/drafting/MatterAssistantPanel', () => ({ MatterAssistantPanel: () => <div>Assistant panel</div> }))
vi.mock('@/components/drafting/TabularReviewSection', () => ({ TabularReviewSection: () => null }))
vi.mock('@/components/documents/DocumentPreviewDialog', () => ({ DocumentPreviewDialog: () => null }))
vi.mock('@/lib/documents', () => ({ deleteDocument: vi.fn(), getDocumentUrl: vi.fn(), isWordDocument: (n: string) => /\.docx?$/i.test(n), isPdfDocument: (n: string) => /\.pdf$/i.test(n), setDocumentReviewed: mocks.review, setDocumentShared: mocks.share, uploadDocument: vi.fn() }))
vi.mock('@/lib/matterActivity', () => ({ logMatterActivity: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import ReviewStep from '@/app/admin/drafting/[matterId]/ReviewStep'

const makeDoc = (id: string, name: string, extras: Partial<DraftingHubDocument> = {}): DraftingHubDocument => ({ id, name, size: 120, created_at: '2026-09-11T10:00:00Z', generationId: 'gen', generationEngine: 'template', markerCount: 0, missingCount: 0, reviewedAt: null, reviewedBy: null, supersededAt: null, ...extras })
const drafts = [makeDoc('trust', 'Trust.docx'), makeDoc('will', 'Will.docx'), makeDoc('blocked', 'Proxy.pdf', { missingCount: 2 })]
const renderReview = () => render(<TooltipProvider><ReviewStep matterId="matter" hubMatter={{ recentDrafts: drafts, supersededDrafts: [], draftCount: 3 } as unknown as DraftingHubMatter} sharedDrafts={[]} /></TooltipProvider>)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.revision = 'revision:trust'
  Element.prototype.scrollIntoView = vi.fn()
  mocks.review.mockResolvedValue({})
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/review') ? { reviewRevision: `revision:${url.split('/')[3]}`, reviewedAt: null, eligibility: { shareable: true } } : { document: {} }), { status: 200 }))
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('draft review workspace', () => {
  it('requires loaded bytes before deliberately marking this version and moves to next unreviewed', async () => {
    renderReview()
    fireEvent.click(screen.getAllByRole('button', { name: 'Review in app' })[0])
    const review = screen.getByRole('button', { name: 'Mark this version reviewed' })
    expect(review).toBeDisabled()
    expect(screen.queryByText('Assistant panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load version trust' }))
    await waitFor(() => expect(review).not.toBeDisabled())
    fireEvent.click(review)
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('trust', true, 'revision:trust'))
    fireEvent.click(screen.getByRole('button', { name: 'Next unreviewed' }))
    expect(screen.getByRole('button', { name: 'Load version will' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Documents to review' })).toBeInTheDocument()
  })
  it('clears an optimistic review when refreshed content has a new revision', async () => {
    const view = renderReview()
    fireEvent.click(screen.getAllByRole('button', { name: 'Review in app' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Load version trust' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark this version reviewed' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Mark this version reviewed' }))
    await waitFor(() => expect(mocks.review).toHaveBeenCalled())
    const updated = drafts.map(doc => doc.id === 'trust' ? { ...doc, reviewedAt: null, reviewRevision: 'revision:trust-v2' } : doc)
    view.rerender(<TooltipProvider><ReviewStep matterId="matter" hubMatter={{ recentDrafts: updated, supersededDrafts: [], draftCount: 3 } as unknown as DraftingHubMatter} sharedDrafts={[]} /></TooltipProvider>)
    mocks.revision = 'revision:trust-v2'
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ reviewRevision: 'revision:trust-v2', reviewedAt: null, eligibility: { shareable: true } })))
    fireEvent.click(screen.getByRole('button', { name: 'Load version trust' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark this version reviewed' })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: 'Clear review' })).toBeNull()
  })
  it('prefers a live clean scan over the old generation missing count', async () => {
    const rows = [{ ...drafts[0], missingCount: 2 }]
    render(<TooltipProvider><ReviewStep matterId="matter" hubMatter={{ recentDrafts: rows, supersededDrafts: [], draftCount: 1 } as unknown as DraftingHubMatter} sharedDrafts={[]} /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Review in app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load version trust' }))
    await waitFor(() => expect(screen.queryByText('2 unfilled fields · sharing blocked')).toBeNull())
  })
  it('converts just selected documents and retains failure selection for retry', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Worker unavailable' }), { status: 503 }))
    renderReview()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Will.docx for conversion' }))
    fireEvent.click(screen.getByRole('button', { name: 'Convert selected (1)' }))
    await waitFor(() => expect(screen.getByText('Will.docx: Failed — Worker unavailable')).toBeInTheDocument())
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/documents/will/convert-pdf')
    expect(screen.getByRole('checkbox', { name: 'Select Will.docx for conversion' })).toBeChecked()
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('keeps missing-field PDF sharing blocked even when marker count is zero', () => {
    renderReview()
    expect(screen.getByRole('button', { name: 'Share PDF' })).toBeDisabled()
    expect(screen.getByText('2 unfilled fields · sharing blocked')).toBeInTheDocument()
  })
})
