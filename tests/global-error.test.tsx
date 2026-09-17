// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getFirmConfig } from '@/lib/firmConfig'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

afterEach(cleanup)

/**
 * This is the last resort, not a route's boundary — it replaces the whole
 * document, layout and fonts included. Clients can still reach it, so it now
 * speaks as the firm rather than as the product: it used to head itself "We
 * could not load Cornerstone", a name no client has heard.
 */
describe('global error boundary', () => {
  it('reports root rendering failures and gives the user a retry action', async () => {
    const Sentry = await import('@sentry/nextjs')
    const { default: GlobalError } = await import('../app/global-error')
    const reset = vi.fn()
    const error = Object.assign(new Error('root layout failed'), { digest: 'digest-123' })

    render(<GlobalError error={error} reset={reset} />)

    expect(screen.getByRole('heading', { name: 'We could not load this page' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledOnce()
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledWith(error))
  })

  it('names the firm and gives a way to reach it', async () => {
    // Retry is the only thing this screen used to offer, and it is the thing
    // that just failed. A person stuck here needs a telephone number.
    const { default: GlobalError } = await import('../app/global-error')
    const firm = getFirmConfig()
    render(<GlobalError error={new Error('boom')} reset={vi.fn()} />)

    expect(screen.getByText(firm.firmName)).toBeTruthy()
    expect(screen.getByRole('link', { name: firm.phone }).getAttribute('href'))
      .toBe(`tel:${firm.phone.replace(/[^\d+]/g, '')}`)
    expect(screen.getByRole('link', { name: firm.email }).getAttribute('href'))
      .toBe(`mailto:${firm.email}`)
  })
})
