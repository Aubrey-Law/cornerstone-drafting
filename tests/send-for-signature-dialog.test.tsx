// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CEREMONY_ATTESTATION_TEXT } from '@/lib/esign/ceremony'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import type { MatterDocument } from '@/types/database'

/**
 * Sending a document for signature, from the documents tab.
 *
 * The send itself has been tested since #546; what is new here is the only part
 * an attorney touches. Most of these are refusals — a signature request that
 * reaches a signer cannot be unsent, so the interesting properties are the ones
 * that stop it going out wrong.
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
  sendDocumentForSignature: vi.fn(async () => ({ requestId: 'req-1', recipients: [] })),
}))

import { sendDocumentForSignature } from '@/lib/documents'
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
    created_at: '2026-09-01T12:00:00.000Z',
    ...overrides,
  }
}

const PDF = doc({ id: 'd1', name: 'HIPAA authorization.pdf' })
const WORD = doc({
  id: 'd2',
  name: 'Trust draft.docx',
  content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})

function renderTab(overrides: Partial<Parameters<typeof MatterDocumentsTab>[0]> = {}) {
  return render(
    <MatterDocumentsTab
      matterId={MATTER_ID}
      documents={[PDF, WORD]}
      loading={false}
      onDocumentsChanged={vi.fn()}
      esignDocumentsEnabled
      defaultSigner={{ name: 'Walter White', email: 'walter@example.com' }}
      {...overrides}
    />,
  )
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
}

/** Open the row menu and the dialog behind "Send for signature". */
async function openDialog(user: ReturnType<typeof userEvent.setup>, name = PDF.name) {
  await openMenu(user, name)
  await user.click(await screen.findByRole('menuitem', { name: /Send for signature/ }))
  return screen.findByRole('dialog')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('offering the action', () => {
  it('is not offered on a document that is not a PDF', async () => {
    // The route refuses anything else outright; the page it appends is a PDF
    // page and there is nothing to append it to.
    const user = userEvent.setup()
    renderTab()
    await openMenu(user, WORD.name)
    expect(await screen.findByRole('menuitem', { name: /Download/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Send for signature/ })).toBeNull()
  })

  it('is not offered at all when the firm does not have the feature', async () => {
    // esign_documents_enabled fails closed. A menu item that 403s is worse
    // than no menu item.
    const user = userEvent.setup()
    renderTab({ esignDocumentsEnabled: false })
    await openMenu(user, PDF.name)
    expect(await screen.findByRole('menuitem', { name: /Download/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Send for signature/ })).toBeNull()
  })
})

describe('the dialog', () => {
  it('opens on the client, with the name the send would have used anyway', async () => {
    const user = userEvent.setup()
    renderTab()
    const dialog = await openDialog(user)

    // The route falls back to the file name with .pdf stripped. Showing the
    // same thing means the field is editable rather than load-bearing.
    const value = (label: string) =>
      (within(dialog).getByLabelText(label) as HTMLInputElement).value
    expect(value('Document name')).toBe('HIPAA authorization')
    expect(value('Signer 1 name')).toBe('Walter White')
    expect(value('Signer 1 email')).toBe('walter@example.com')
  })

  it('shows the attestation an attorney is recorded as having agreed to, word for word', async () => {
    // The wording is stored on the request. If what is displayed and what is
    // stored were two strings, the row would record something nobody read.
    const user = userEvent.setup()
    renderTab()
    const dialog = await openDialog(user)
    expect(within(dialog).getByText(CEREMONY_ATTESTATION_TEXT)).toBeTruthy()
  })

  it('will not send until the attestation is ticked', async () => {
    const user = userEvent.setup()
    renderTab()
    const dialog = await openDialog(user)

    const send = within(dialog).getByRole('button', { name: /Send for signature/ }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    await user.click(within(dialog).getByRole('checkbox', { name: /witnessed or notarized/i }))
    expect(send.disabled).toBe(false)
  })
})

describe('sending', () => {
  async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /witnessed or notarized/i }))
    await user.click(within(dialog).getByRole('button', { name: /Send for signature/ }))
    return dialog
  }

  it('sends what was typed, with the attestation and the document it came from', async () => {
    const user = userEvent.setup()
    const onDocumentsChanged = vi.fn()
    renderTab({ onDocumentsChanged })

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /Add signer/ }))
    await user.type(within(dialog).getByLabelText('Signer 2 name'), 'Skylar White')
    await user.type(within(dialog).getByLabelText('Signer 2 email'), 'skylar@example.com')
    await user.type(within(dialog).getByLabelText('Signer 2 role'), 'Spouse')
    await user.type(within(dialog).getByLabelText('Message'), 'Please sign at your convenience.')
    await user.click(within(dialog).getByRole('checkbox', { name: /witnessed or notarized/i }))
    await user.click(within(dialog).getByRole('button', { name: /Send for signature/ }))

    await waitFor(() => expect(sendDocumentForSignature).toHaveBeenCalledTimes(1))
    expect(vi.mocked(sendDocumentForSignature).mock.calls[0]).toEqual([MATTER_ID, {
      documentId: 'd1',
      name: 'HIPAA authorization',
      signers: [
        { name: 'Walter White', email: 'walter@example.com' },
        { name: 'Skylar White', email: 'skylar@example.com', role: 'Spouse' },
      ],
      message: 'Please sign at your convenience.',
      expirationHours: 168,
      ceremonyAttested: true,
    }])
    expect(toast.success).toHaveBeenCalledWith('Sent to 2 signers')
    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalled())
  })

  it('sends once, however fast the button is clicked', async () => {
    // There is no dedupe on the server: a second send is a second request, a
    // second set of links, and a signer holding two live tokens for one
    // document. Two clicks dispatched before React re-renders both find the
    // button enabled and `sending` still false, so the guard cannot be state.
    let release: (() => void) | undefined
    vi.mocked(sendDocumentForSignature).mockImplementationOnce(
      () => new Promise(resolve => { release = () => resolve({ requestId: 'req-1', recipients: [] }) }),
    )
    const user = userEvent.setup()
    renderTab()

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /witnessed or notarized/i }))
    const send = within(dialog).getByRole('button', { name: /Send for signature/ })
    // Native clicks, not fireEvent: fireEvent wraps each dispatch in act(), which
    // flushes the re-render between them and hands the second click an already
    // disabled button. Two raw dispatches in one synchronous block is the
    // double-click as the browser would deliver it.
    send.click()
    send.click()

    await waitFor(() => expect(sendDocumentForSignature).toHaveBeenCalledTimes(1))
    release?.()
  })

  it('shows the server’s refusal in its own words', async () => {
    // "This document already contains signature markers" tells an attorney
    // what to do next. "Could not send" does not.
    vi.mocked(sendDocumentForSignature).mockRejectedValueOnce(
      new Error('This document already contains signature markers ([[SIGN_1_SIGNATURE]])'),
    )
    const user = userEvent.setup()
    renderTab()
    await fillAndSend(user)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'This document already contains signature markers ([[SIGN_1_SIGNATURE]])',
    ))
    // And the dialog stays open, holding what was typed, so it can be retried.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('refuses two signers sharing an address before the round trip', async () => {
    const user = userEvent.setup()
    renderTab()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /Add signer/ }))
    await user.type(within(dialog).getByLabelText('Signer 2 name'), 'Skylar White')
    await user.type(within(dialog).getByLabelText('Signer 2 email'), 'WALTER@example.com')
    await user.click(within(dialog).getByRole('checkbox', { name: /witnessed or notarized/i }))
    await user.click(within(dialog).getByRole('button', { name: /Send for signature/ }))

    expect(toast.error).toHaveBeenCalledWith('Each signer needs their own email address')
    expect(sendDocumentForSignature).not.toHaveBeenCalled()
  })
})

describe('a document already out for signature', () => {
  const live: SignatureRequestSummary = {
    id: 'req-1',
    name: 'HIPAA authorization',
    sourceDocumentId: 'd1',
    state: 'partially_signed',
    signedCount: 1,
    signerCount: 2,
    sentAt: '2026-09-17T14:00:00.000Z',
    completedAt: null,
    error: null,
    signers: [
      { name: 'Walter White', email: 'walter@example.com', state: 'signed', viewedAt: null, signedAt: '2026-09-17T15:00:00.000Z', declinedAt: null },
      { name: 'Skylar White', email: 'skylar@example.com', state: 'sent', viewedAt: null, signedAt: null, declinedAt: null },
    ],
  }

  it('says so on the row, with how far it has got', () => {
    renderTab({ signatureRequests: [live] })
    // The count is the point: "out for signature" and "one of two signed" are
    // different situations for someone chasing a second signature.
    expect(screen.getByText(/Partly signed/).textContent).toBe('Partly signed 1/2')
  })

  it('warns before sending a second set of links to the same people', async () => {
    const user = userEvent.setup()
    renderTab({ signatureRequests: [live] })
    const dialog = await openDialog(user)

    const warning = within(dialog).getByRole('alert')
    expect(warning.textContent).toContain('already out for signature')
    expect(warning.textContent).toContain('skylar@example.com')
  })

  it('does not warn about one that is already finished', async () => {
    const user = userEvent.setup()
    renderTab({ signatureRequests: [{ ...live, state: 'signed', signedCount: 2 }] })
    const dialog = await openDialog(user)
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })
})
