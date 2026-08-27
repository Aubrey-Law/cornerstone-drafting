// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

// The real component loads office.js from Microsoft's CDN for its side effect.
// Rendering a script tag in jsdom would attempt a network fetch, so it becomes
// a no-op: every test drives `window.Office` directly instead.
vi.mock('next/script', () => ({ default: () => null }))

vi.mock('@/components/layout/AuthShell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const getSession = vi.fn()
const maybeSingle = vi.fn()
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  },
}))

import AddinAuthPage from '@/app/auth/addin/page'

function sessionFor(role: string) {
  getSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_at: 1_800_000_000,
        user: { id: 'user-1', email: 'attorney@example.com' },
      },
    },
  })
  maybeSingle.mockResolvedValue({ data: { role } })
}

/** Office as Word actually provides it inside a dialog. */
function installOffice() {
  const messageParent = vi.fn()
  ;(globalThis as Record<string, unknown>).Office = {
    onReady: () => Promise.resolve({}),
    context: { ui: { messageParent } },
  }
  return messageParent
}

beforeEach(() => {
  vi.clearAllMocks()
  delete (globalThis as Record<string, unknown>).Office
})
afterEach(cleanup)

/**
 * The dialog previously gated *everything* on an Office-ready callback reached
 * through an optional chain. When that callback did not fire, the page waited
 * forever showing a string identical to the task pane's — which is why four
 * fixes went to the wrong component.
 */
describe('add-in sign-in dialog', () => {
  it('sends a signed-out user to login without waiting for Office', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    // Office deliberately absent: the redirect must not depend on it.
    render(<AddinAuthPage />)

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/auth/login?redirectTo=/auth/addin'),
    )
  })

  it('hands the session to Word once, with the payload the pane expects', async () => {
    sessionFor('attorney')
    const messageParent = installOffice()

    render(<AddinAuthPage />)

    await waitFor(() => expect(messageParent).toHaveBeenCalledTimes(1))
    expect(JSON.parse(messageParent.mock.calls[0][0] as string)).toEqual({
      type: 'cornerstone-addin-session',
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: 1_800_000_000,
      email: 'attorney@example.com',
    })
    expect(await screen.findByText(/Returning to Word/i)).toBeTruthy()
  })

  it('offers the token instead of hanging when Office never arrives', async () => {
    sessionFor('admin')
    // No Office global at all — the old code's permanent wait.
    render(<AddinAuthPage />)

    expect(await screen.findByText(/Word did not respond/i, {}, { timeout: 20_000 })).toBeTruthy()
    const field = (await screen.findByLabelText('Access token')) as HTMLTextAreaElement
    expect(field.value).toBe('access-123')
  }, 30_000)

  it('refuses a non-staff role and never messages Word', async () => {
    sessionFor('client')
    const messageParent = installOffice()

    render(<AddinAuthPage />)

    expect(await screen.findByText(/does not have firm access/i)).toBeTruthy()
    expect(messageParent).not.toHaveBeenCalled()
  })

  /**
   * The meta-bug. Both the dialog and the pane said "Checking your session…",
   * so a stuck dialog and a stuck pane were indistinguishable in a screenshot
   * or a bug report — and four fixes went to the wrong component before the
   * `isDialog` marker in a DOM dump gave it away.
   */
  it('shares no waiting text with the task pane', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

    // Matches user-facing waiting phrases wherever they live — a quoted
    // literal in the dialog's STATUS_TEXT map, or bare JSX text in the pane.
    // An earlier version only looked at quoted strings, so it could not see
    // the pane's `<p>Checking your session…</p>` and passed while the very
    // collision it guards was present.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    const phrases = (source: string) =>
      new Set(
        Array.from(
          stripComments(source).matchAll(/([A-Z][^<>'"`{}\n]{8,}?…)/g),
          m => m[1].trim(),
        ),
      )

    const dialog = phrases(read('app/auth/addin/page.tsx'))
    const pane = phrases(read('word-addin/src/taskpane/App.tsx'))

    expect(dialog.size).toBeGreaterThan(0)
    expect(pane.size).toBeGreaterThan(0)
    const shared = [...dialog].filter(text => pane.has(text))
    expect(shared).toEqual([])
  })

  it('surfaces an unexpected failure rather than waiting on it', async () => {
    getSession.mockRejectedValue(new Error('network down'))

    render(<AddinAuthPage />)

    expect(await screen.findByText(/network down/i)).toBeTruthy()
  })
})
