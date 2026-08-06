// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MatterDocument } from '@/types/database'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

// The tab only needs these at interaction time; the render path must not call them.
vi.mock('@/lib/documents', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/documents')>()),
  deleteDocument: vi.fn(),
  downloadDocumentsZip: vi.fn(),
  getDocumentAuditEvents: vi.fn(async () => []),
  getDocumentUrl: vi.fn(),
  getDocumentViewerUrl: vi.fn(),
  renameDocument: vi.fn(),
  setDocumentReviewed: vi.fn(),
  setDocumentShared: vi.fn(),
  uploadDocument: vi.fn(),
}))

import { MatterDocumentsTab } from '@/app/admin/matters/[id]/MatterDocumentsTab'

const MATTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function doc(overrides: Partial<MatterDocument> & { id: string; name: string }): MatterDocument {
  return {
    matter_id: MATTER_ID,
    r2_key: `documents/${overrides.id}`,
    size: 2048,
    content_type: 'application/pdf',
    shared_at: null,
    source: 'firm',
    uploaded_by: null,
    created_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

const documents: MatterDocument[] = [
  doc({ id: 'd1', name: 'Chen Trust — SIGNED.pdf', size: 4096 }),
  doc({ id: 'd2', name: 'Chen Trust draft.docx', generation_id: 'gen-1', size: 1024 }),
  doc({ id: 'd3', name: 'Deed from client.pdf', source: 'client', size: 8192 }),
  doc({ id: 'd4', name: 'Engagement letter.pdf', size: 512 }),
  doc({ id: 'd5', name: 'Meeting recap.docx', source: 'meeting-notes' }),
]

function renderTab(overrides: Partial<Parameters<typeof MatterDocumentsTab>[0]> = {}) {
  return render(
    <MatterDocumentsTab
      matterId={MATTER_ID}
      documents={documents}
      loading={false}
      onDocumentsChanged={vi.fn()}
      {...overrides}
    />,
  )
}

describe('documents tab file manager', () => {
  afterEach(cleanup)

  it('lists derived folders above every file at the root', () => {
    renderTab()

    // Folder rows carry a unique select-all control; the label itself repeats
    // on each file row as that file's folder chip.
    for (const label of ['From client', 'Signed & executed', 'Generated drafts', 'Firm files']) {
      expect(screen.getByRole('checkbox', { name: `Select everything in ${label}` })).toBeTruthy()
    }
    // Meeting notes have their own card and never appear here.
    expect(screen.queryByText(/Meeting recap/)).toBeNull()
    // Rows show the display title, which drops the extension.
    expect(screen.getByText('Engagement letter')).toBeTruthy()
  })

  it('narrows to one folder and back out through the breadcrumb', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Signed & executed/ }))

    const breadcrumb = screen.getByRole('navigation', { name: 'Folder breadcrumb' })
    expect(within(breadcrumb).getByText('Signed & executed')).toBeTruthy()
    expect(screen.getByText('Chen Trust — SIGNED')).toBeTruthy()
    expect(screen.queryByText('Engagement letter')).toBeNull()

    await user.click(within(breadcrumb).getByRole('button', { name: 'All documents' }))
    expect(screen.getByText('Engagement letter')).toBeTruthy()
  })

  it('selects a whole folder in one click and offers the bulk actions', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('checkbox', { name: 'Select everything in From client' }))

    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download selected/ })).toBeTruthy()
  })

  it('reorders the list when the sort direction flips', async () => {
    const user = userEvent.setup()
    renderTab()

    const names = () => screen.getAllByRole('switch').map(node => node.getAttribute('aria-label'))
    const ascending = names()

    await user.click(screen.getByRole('button', { name: /Sort: Name/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Descending' }))

    expect(names()).toEqual([...ascending].reverse())
  })

  it('keeps the search across folders and reports an empty result', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.type(screen.getByLabelText('Search documents'), 'zzzz')
    expect(screen.getByText('No matching documents')).toBeTruthy()
  })
})
