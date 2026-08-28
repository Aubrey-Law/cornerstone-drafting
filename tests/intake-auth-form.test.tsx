/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import IntakeAuthForm from '@/app/intake/auth/IntakeAuthForm'

const replace = vi.fn()
const signInWithPassword = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPassword(...args) } },
}))

vi.mock('@/lib/auth/ensureUserProfile', () => ({ ensureUserProfile: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const submitButton = () => screen.getByRole('button', { name: /Create account/ })

describe('IntakeAuthForm', () => {
  it('stays disabled until all three fields are filled', async () => {
    const user = userEvent.setup()
    render(<IntakeAuthForm inviteToken="token-1" />)

    expect(submitButton().hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText('Email address'), 'ada@example.com')
    await user.type(screen.getByLabelText('Create a password'), 'longenough')
    expect(submitButton().hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText('Confirm password'), 'longenough')
    await waitFor(() => {
      expect(submitButton().hasAttribute('disabled')).toBe(false)
    })
  })

  it('reports a short password and a mismatch without calling the signup route', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<IntakeAuthForm inviteToken="token-1" />)

    await user.type(screen.getByLabelText('Email address'), 'ada@example.com')
    await user.type(screen.getByLabelText('Create a password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'shorter')
    await user.click(submitButton())

    await waitFor(() => {
      expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()
    })
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offers a sign-in link when the account already exists', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'User already registered' }), { status: 409 }),
    )
    render(<IntakeAuthForm inviteToken="token-1" invitedEmail="ada@example.com" />)

    await user.type(screen.getByLabelText('Create a password'), 'longenough')
    await user.type(screen.getByLabelText('Confirm password'), 'longenough')
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('An account with this email already exists.')
    // The footer carries its own standing "Sign in" link, so scope to the alert.
    expect(within(alert).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/auth/login?redirectTo=%2Fintake',
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('signs the client in and sends them to the questionnaire', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    )
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    render(<IntakeAuthForm inviteToken="token-1" invitedEmail="ada@example.com" />)

    await user.type(screen.getByLabelText('Create a password'), 'longenough')
    await user.type(screen.getByLabelText('Confirm password'), 'longenough')
    await user.click(submitButton())

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/intake')
    })
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'longenough',
    })
  })
})
