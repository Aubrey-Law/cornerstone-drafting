// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  getDocumentPreview: vi.fn(async () => ({ html: '' })),
  renameDocument: vi.fn(),
  setDocumentReviewed: vi.fn(),
  setDocumentShared: vi.fn(),
  uploadDocument: vi.fn(),
}))

import { deleteDocument } from '@/lib/documents'
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
  doc({ id: 'd6', name: 'Retainer notes.docx', size: 256 }),
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
  afterEach(() => {
    cleanup()
    // Call records only — the module mock keeps its implementations.
    vi.clearAllMocks()
  })

  it('opens unreviewed client uploads across folders from the matter shortcut', () => {
    renderTab({ initialScope: 'unreviewed' })
    expect(screen.getByText('Deed from client')).toBeTruthy()
    expect(screen.queryByText('Engagement letter')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Select everything in From client' })).toBeNull()
  })

  it('reports filter changes so a later unreviewed shortcut can restore its scope', async () => {
    const user = userEvent.setup()
    const onScopeChange = vi.fn()
    const view = renderTab({initialScope:'unreviewed', onScopeChange})
    await user.click(screen.getByRole('button', {name:/Unreviewed/}))
    await user.click(screen.getByRole('menuitemcheckbox', {name:/All/}))
    expect(onScopeChange).toHaveBeenCalledWith('all')
    view.rerender(<MatterDocumentsTab matterId={MATTER_ID} documents={documents} loading={false} onDocumentsChanged={vi.fn()} initialScope="all" />)
    view.rerender(<MatterDocumentsTab matterId={MATTER_ID} documents={documents} loading={false} onDocumentsChanged={vi.fn()} initialScope="unreviewed" />)
    expect(screen.getByText('Deed from client')).toBeTruthy()
    expect(screen.queryByText('Engagement letter')).toBeNull()
  })

  it('lists the folders and only the files that are in none of them', () => {
    renderTab()

    // Folder rows carry a unique select-all control.
    for (const label of ['From client', 'Signed & executed', 'Generated drafts']) {
      expect(screen.getByRole('checkbox', { name: `Select everything in ${label}` })).toBeTruthy()
    }
    // Rows show the display title, which drops the extension. Only the loose
    // firm files appear beside the folders — nothing is listed twice.
    expect(screen.getByText('Engagement letter')).toBeTruthy()
    expect(screen.getByText('Retainer notes')).toBeTruthy()
    expect(screen.queryByText('Chen Trust — SIGNED')).toBeNull()
    expect(screen.queryByText('Deed from client')).toBeNull()
    // Meeting notes have their own card and never appear here.
    expect(screen.queryByText(/Meeting recap/)).toBeNull()
  })

  it('flattens a search across the folders instead of hiding hits behind them', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.type(screen.getByLabelText('Search documents'), 'chen')

    // The match inside a folder is a result in its own right, chipped with the
    // folder it came from, and the tiles step aside.
    expect(screen.getByText('Chen Trust — SIGNED')).toBeTruthy()
    expect(screen.getByText('Signed & executed')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Select everything in From client' })).toBeNull()
    expect(screen.queryByText('Engagement letter')).toBeNull()
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

  /** Select the two loose firm files at the root and open the delete dialog. */
  async function confirmDeleteBothLooseFiles(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: 'Select Engagement letter.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Retainer notes.docx' }))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    return screen.findByRole('alertdialog')
  }

  it('deletes the whole selection behind one confirmation', async () => {
    const user = userEvent.setup()
    const onDocumentsChanged = vi.fn()
    renderTab({ onDocumentsChanged })

    const dialog = await confirmDeleteBothLooseFiles(user)
    // Nothing here is recoverable, so the dialog names every file going.
    expect(within(dialog).getByText('Delete 2 documents?')).toBeTruthy()
    expect(within(dialog).getByText('Engagement letter.pdf')).toBeTruthy()
    expect(within(dialog).getByText('Retainer notes.docx')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 documents' }))

    await waitFor(() => {
      expect(vi.mocked(deleteDocument).mock.calls.map(call => call[0])).toEqual(['d4', 'd6'])
    })
    expect(toast.success).toHaveBeenCalledWith('Deleted 2 documents')
    expect(onDocumentsChanged).toHaveBeenCalled()
  })

  it('keeps deleting the rest of the batch when one file refuses', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteDocument).mockRejectedValueOnce(new Error('Locked by a signature request'))
    renderTab()

    const dialog = await confirmDeleteBothLooseFiles(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 documents' }))

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledTimes(2))
    expect(toast.error).toHaveBeenCalledWith('Engagement letter.pdf: Locked by a signature request')
    expect(toast.success).toHaveBeenCalledWith('Document deleted')
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

  it('sorts by the title the row shows, not the raw filename', () => {
    renderTab({
      clientName: 'Jordan Client',
      documents: [
        doc({ id: 'w', name: 'Jordan Client Will.pdf' }),
        doc({ id: 'p', name: 'Power of Attorney.pdf' }),
        doc({ id: 'a', name: 'Advance Directive.pdf' }),
      ],
    })

    // Raw names sort Advance, Jordan…Will, Power; the rows read Advance, Power, Will.
    const order = screen.getAllByRole('switch').map(node => node.getAttribute('aria-label'))
    expect(order).toEqual([
      'Share Advance Directive.pdf with the client',
      'Share Power of Attorney.pdf with the client',
      'Share Jordan Client Will.pdf with the client',
    ])
  })

  it('keeps the search across folders and reports an empty result', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.type(screen.getByLabelText('Search documents'), 'zzzz')
    expect(screen.getByText('No matching documents')).toBeTruthy()
  })

  it('offers only the bulk share action that would change something', async () => {
    const user = userEvent.setup()
    renderTab({
      documents: documents.map(d => d.id === 'd6' ? { ...d, shared_at: '2026-08-02T12:00:00.000Z' } : d),
    })

    await user.click(screen.getByRole('checkbox', { name: 'Select Engagement letter.pdf' }))
    expect((screen.getByRole('button', { name: /^Share$/ }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: /Unshare/ }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: 'Select Engagement letter.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Retainer notes.docx' }))
    expect((screen.getByRole('button', { name: /^Share$/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Unshare/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('carries the date and size on the row for the widths that hide their columns', () => {
    renderTab()
    const row = document.getElementById('document-row-d4')!
    // The firm-day date, then the size: what a phone sees in place of the columns.
    expect(within(row).getByText(/^Aug 1, 2026/).textContent).toBe('Aug 1, 2026 · 512 B')
  })
})
