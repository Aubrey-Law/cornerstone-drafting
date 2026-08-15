// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

afterEach(cleanup)

describe('global error boundary', () => {
  it('reports root rendering failures and gives the user a retry action', async () => {
    const Sentry = await import('@sentry/nextjs')
    const { default: GlobalError } = await import('../app/global-error')
    const reset = vi.fn()
    const error = Object.assign(new Error('root layout failed'), { digest: 'digest-123' })

    render(<GlobalError error={error} reset={reset} />)

    expect(screen.getByRole('heading', { name: 'We could not load Cornerstone' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledOnce()
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledWith(error))
  })
})
