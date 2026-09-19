// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import type { MatterDocument } from '@/types/database'

/**
 * Taking a request back, and chasing a signer who has not acted.
 *
 * Both are one click away from an email or a dead link in a client's inbox, so
 * what is tested here is mostly what they refuse to offer and what they tell
 * the attorney before they act.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

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
  sendDocumentForSignature: vi.fn(),
  cancelSignatureRequest: vi.fn(async () => {}),
  resendSignatureRequest: vi.fn(async () => ({ email: 'skylar@example.com' })),
}))

import { cancelSignatureRequest, resendSignatureRequest } from '@/lib/documents'
import { MatterDocumentsTab } from '@/app/admin/matters/[id]/MatterDocumentsTab'

const MATTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PDF: MatterDocument = {
  id: 'd1', name: 'HIPAA authorization.pdf', matter_id: MATTER_ID, r2_key: 'k1', size: 2048,
  content_type: 'application/pdf', shared_at: null, source: 'firm', uploaded_by: null,
  created_at: '2026-09-17T14:00:00.000Z',
}

function request(overrides: Partial<SignatureRequestSummary> = {}): SignatureRequestSummary {
  return {
    id: 'req-1',
    name: 'HIPAA authorization',
    sourceDocumentId: 'd1',
    state: 'partially_signed',
    signedCount: 1,
    signerCount: 2,
    sentAt: '2026-09-17T14:02:00.000Z',
    completedAt: null,
    error: null,
    signers: [
      { recipientKey: 'signer_1', name: 'Walter White', email: 'walter@example.com', state: 'signed', viewedAt: null, signedAt: '2026-09-17T15:00:00.000Z', declinedAt: null },
      { recipientKey: 'signer_2', name: 'Skylar White', email: 'skylar@example.com', state: 'sent', viewedAt: null, signedAt: null, declinedAt: null },
    ],
    ...overrides,
  }
}

function renderTab(requests: SignatureRequestSummary[], onDocumentsChanged = vi.fn()) {
  return render(
    <MatterDocumentsTab
      matterId={MATTER_ID}
      documents={[PDF]}
      loading={false}
      onDocumentsChanged={onDocumentsChanged}
      esignDocumentsEnabled
      signatureRequests={requests}
    />,
  )
}

const openRowMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: `Actions for ${PDF.name}` }))

async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await openRowMenu(user)
  await user.click(await screen.findByRole('menuitem', { name: /History/ }))
  return screen.findByRole('dialog')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('withdrawing a request', () => {
  it('is offered only while something is still signable', async () => {
    const user = userEvent.setup()
    renderTab([request({ state: 'signed', signedCount: 2 })])
    await openRowMenu(user)
    expect(await screen.findByRole('menuitem', { name: /Send for signature/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Withdraw/ })).toBeNull()
  })

  it('says what withdrawing costs before it happens', async () => {
    const user = userEvent.setup()
    renderTab([request()])
    await openRowMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /Withdraw signature request/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('stops working')
    expect(dialog.textContent).toContain('cannot be undone')
    // Someone already signed. Withdrawing does not unmake that, and the person
    // about to do it should know before they do.
    expect(within(dialog).getByRole('alert').textContent).toContain('Walter White')
  })

  it('will not withdraw without a reason, and sends the one that was typed', async () => {
    const user = userEvent.setup()
    const onDocumentsChanged = vi.fn()
    renderTab([request()], onDocumentsChanged)
    await openRowMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /Withdraw signature request/ }))

    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Withdraw request' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    await user.type(within(dialog).getByLabelText(/Why is it being withdrawn/), 'Wrong version sent')
    expect(confirm.disabled).toBe(false)
    await user.click(confirm)

    await waitFor(() => expect(cancelSignatureRequest).toHaveBeenCalledWith(MATTER_ID, 'req-1', 'Wrong version sent'))
    expect(toast.success).toHaveBeenCalledWith('Signature request withdrawn')
    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalled())
  })

  it('shows the server’s refusal rather than a generic line', async () => {
    vi.mocked(cancelSignatureRequest).mockRejectedValueOnce(
      new Error('This document has been signed and completed; it cannot be withdrawn'),
    )
    const user = userEvent.setup()
    renderTab([request()])
    await openRowMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /Withdraw signature request/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Why is it being withdrawn/), 'too late')
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw request' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'This document has been signed and completed; it cannot be withdrawn',
    ))
  })
})

describe('resending a link', () => {
  it('is offered for the signer still outstanding, and not for the one who signed', async () => {
    const user = userEvent.setup()
    renderTab([request()])
    const sheet = await openHistory(user)

    const rows = within(sheet).getAllByRole('listitem')
    const walter = rows.find(row => row.textContent?.includes('walter@example.com'))!
    const skylar = rows.find(row => row.textContent?.includes('skylar@example.com'))!
    expect(within(walter).queryByRole('button', { name: /Resend/ })).toBeNull()
    expect(within(skylar).getByRole('button', { name: /Resend/ })).toBeTruthy()
  })

  it('is not offered once the request itself is finished', async () => {
    const user = userEvent.setup()
    renderTab([request({ state: 'cancelled' })])
    const sheet = await openHistory(user)
    expect(within(sheet).queryByRole('button', { name: /Resend/ })).toBeNull()
  })

  it('sends to that one signer and says who got it', async () => {
    const user = userEvent.setup()
    const onDocumentsChanged = vi.fn()
    renderTab([request()], onDocumentsChanged)
    const sheet = await openHistory(user)

    await user.click(within(sheet).getByRole('button', { name: /Resend/ }))

    await waitFor(() => expect(resendSignatureRequest).toHaveBeenCalledWith(MATTER_ID, 'req-1', 'signer_2', 168))
    expect(toast.success).toHaveBeenCalledWith('New link sent to skylar@example.com')
    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalled())
  })
})
