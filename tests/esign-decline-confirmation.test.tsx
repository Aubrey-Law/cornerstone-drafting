// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SigningExperience } from '@/components/esign/SigningExperience'

/**
 * Declining is the one irreversible thing a client can do on this page, and it
 * used to happen on a single click.
 *
 * The decline fired straight from the button; the only interstitial was
 * `window.prompt('…optional…')`, whose return is null on Cancel and '' on an
 * empty submit. Both are falsy, so `if (reason)` treated them the same and the
 * decline went through either way. A client who pressed Cancel to back out
 * declined their agreement, and the server's 410 meant the link was already
 * dead when they reloaded.
 *
 * These assert the property that was missing: nothing is sent until the client
 * answers the question with the affirmative button.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()
// Radix's dismissable layer reaches for these; jsdom has neither.
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.releasePointerCapture = vi.fn()

const LOADED = {
  documentUrl: 'https://example.test/agreement.pdf',
  signer: { name: 'Ada Okonkwo', email: 'ada@example.test' },
  consentText: 'I agree to sign electronically.',
}

let fetchMock: ReturnType<typeof vi.fn>

/** Every POST the component made, as parsed bodies. */
function posts() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body as string))
}

beforeEach(() => {
  fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, outcome: 'declined' }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(LOADED) })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

async function openSigningPage() {
  const user = userEvent.setup()
  render(<SigningExperience endpoint="/api/sign/tok_123" />)
  // The agreement loads before either button is real.
  await screen.findByRole('button', { name: 'Decline' })
  return user
}

describe('declining an agreement', () => {
  it('asks before it declines, and sends nothing until it is answered', async () => {
    const user = await openSigningPage()

    await user.click(screen.getByRole('button', { name: 'Decline' }))

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('Decline this agreement?')).toBeTruthy()
    // The button opened a question. It must not have declined anything.
    expect(posts()).toEqual([])
  })

  it('sends nothing when the client backs out', async () => {
    // The regression. `window.prompt` returned null here and the decline went
    // through anyway; "Go back" must mean the agreement is untouched.
    const user = await openSigningPage()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(posts()).toEqual([])
    // Still on the signing page, still able to sign.
    expect(screen.getByRole('button', { name: 'Sign agreement' })).toBeTruthy()
  })

  it('declines when the client confirms, with no reason attached if none was given', async () => {
    const user = await openSigningPage()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Decline agreement' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    // An untouched optional field is absent, not an empty string: the column is
    // nullable and "" would read as a reason that was given and left blank.
    expect(posts()[0]).toEqual({ action: 'decline' })
    expect(await screen.findByText('You have declined this agreement')).toBeTruthy()
  })

  it('passes on the reason the client wrote, trimmed', async () => {
    const user = await openSigningPage()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByRole('alertdialog')

    await user.type(
      screen.getByLabelText('Tell the firm why (optional)'),
      '  I want my accountant to read it first.  ',
    )
    await user.click(screen.getByRole('button', { name: 'Decline agreement' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]).toEqual({
      action: 'decline',
      declineReason: 'I want my accountant to read it first.',
    })
  })

  it('keeps what the client typed if they back out and reopen', async () => {
    // Backing out of a consequential question should not cost them the
    // paragraph they just wrote.
    const user = await openSigningPage()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByRole('alertdialog')
    await user.type(screen.getByLabelText('Tell the firm why (optional)'), 'Need more time')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByRole('alertdialog')

    expect((screen.getByLabelText('Tell the firm why (optional)') as HTMLTextAreaElement).value)
      .toBe('Need more time')
  })

  it('says the decline is final before asking for it', async () => {
    // The consequence is the whole reason this dialog exists; a bare
    // "Are you sure?" would not tell the client the link dies.
    const user = await openSigningPage()
    await user.click(screen.getByRole('button', { name: 'Decline' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('cannot be undone')
    expect(dialog.textContent).toContain('signing link stops working')
  })
})
