// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import SignError from '@/app/sign/error'
import IntakeError from '@/app/intake/error'
import BookError from '@/app/book/error'
import { getFirmConfig } from '@/lib/firmConfig'

/**
 * What a client is actually offered when one of these boundaries catches.
 *
 * Coverage — that every client-facing route has a boundary at all — is asserted
 * in client-error-coverage.test.ts, which imports none of these modules so that
 * deleting one fails the coverage check rather than the whole file's imports.
 *
 * The state all of this replaces: the client-facing surfaces had no boundary.
 *
 * `admin` had three and the portal had one. `sign`, `intake` and `book` had
 * none, so a render failure there fell all the way through to
 * `app/global-error.tsx` — which replaces the whole document, and which
 * introduced itself to clients as "Cornerstone Drafting", a product name they
 * have never heard. Its only offer was "Try again": no way back, no telephone
 * number, nothing but the thing that had just broken.
 *
 * These are the surfaces where a crash costs most, because the person on them
 * is a client rather than the firm — alone, untrained, and on the signing page
 * holding a single-use link to an irreversible act.
 */

afterEach(cleanup)

describe('what the client is actually offered', () => {
  const firm = getFirmConfig()
  const cases = [
    ['signing', SignError, 'We could not load your agreement'],
    ['intake', IntakeError, 'We could not load your questionnaire'],
    ['booking', BookError, 'We could not load the booking page'],
  ] as const

  for (const [name, Boundary, title] of cases) {
    describe(name, () => {
      const renderIt = () =>
        render(<Boundary error={new Error('boom')} reset={() => {}} />)

      it('names the firm and gives a way to reach it', () => {
        renderIt()
        expect(screen.getByRole('heading', { name: title })).toBeTruthy()
        expect(screen.getByText(new RegExp(firm.firmName))).toBeTruthy()

        // A number to read is not a number to call on a phone.
        const tel = screen.getByRole('link', { name: firm.phone })
        expect(tel.getAttribute('href')).toBe(`tel:${firm.phone.replace(/[^\d+]/g, '')}`)
        expect(screen.getByRole('link', { name: firm.email }).getAttribute('href'))
          .toBe(`mailto:${firm.email}`)
      })

      it('offers a retry as well', () => {
        renderIt()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
      })

      it('keeps the client-facing serif scope', () => {
        // Wave 4 put the serif on client headings through `client-root`. The one
        // screen that already looks broken should not also change typeface.
        const { container } = renderIt()
        expect(container.querySelector('.client-root')).toBeTruthy()
      })
    })
  }

  it('does not tell a client an irreversible action definitely did not happen', () => {
    // These boundaries catch render failures, and a render can fail after a
    // successful POST. Claiming nothing was signed would make a client who did
    // sign do it twice; telling them how to check is the honest version.
    render(<SignError error={new Error('boom')} reset={() => {}} />)
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/nothing was signed|was not signed|no signature was/i)
    expect(body).toMatch(/call us/i)
  })
})
