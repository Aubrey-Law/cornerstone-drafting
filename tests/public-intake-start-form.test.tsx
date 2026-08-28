/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PublicIntakeStartForm } from '@/app/intake/start/PublicIntakeStartForm'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: vi.fn() } },
}))

// The real widget injects Cloudflare's script; the form only cares about the
// token it hands back.
vi.mock('@/app/intake/start/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken('turnstile-token')}>
      Pass security check
    </button>
  ),
}))

// Submit is disabled without a site key, so the validation cases need one.
const SITE_KEY = 'test-site-key'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PublicIntakeStartForm', () => {
  it('explains the password requirement before submission', () => {
    render(<PublicIntakeStartForm siteKey="" />)

    const password = screen.getByLabelText('Create password')
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()
    expect(password.getAttribute('aria-describedby')).toBe('public-intake-password-help')
  })

  it('lets the client reveal and conceal both password fields', async () => {
    const user = userEvent.setup()
    render(<PublicIntakeStartForm siteKey="" />)

    const password = screen.getByLabelText('Create password')
    const confirmation = screen.getByLabelText('Confirm password')
    const showPassword = screen.getByRole('button', { name: 'Show password' })
    const showConfirmation = screen.getByRole('button', { name: 'Show password confirmation' })

    expect(password.getAttribute('type')).toBe('password')
    expect(confirmation.getAttribute('type')).toBe('password')

    await user.click(showPassword)
    await user.click(showConfirmation)

    expect(password.getAttribute('type')).toBe('text')
    expect(confirmation.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Hide password confirmation' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password.getAttribute('type')).toBe('password')
  })

  it('reports each invalid field and never reaches the register endpoint', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<PublicIntakeStartForm siteKey={SITE_KEY} />)

    await user.type(screen.getByLabelText('Create password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'shorter')
    await user.click(screen.getByRole('button', { name: 'Start secure intake' }))

    // The same sentence is also the standing help text, so assert on the node
    // the password input points at rather than on the string alone.
    await waitFor(() => {
      expect(document.getElementById('public-intake-password-error')?.textContent).toBe(
        'Use at least 8 characters.',
      )
    })
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect(screen.getByText('Complete the security check.')).toBeTruthy()
    expect(screen.getAllByText('Required')).toHaveLength(2) // full name + email
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('prefers the missing-email message over the malformed-email one', async () => {
    const user = userEvent.setup()
    render(<PublicIntakeStartForm siteKey={SITE_KEY} />)

    await user.click(screen.getByRole('button', { name: 'Start secure intake' }))

    await waitFor(() => {
      expect(screen.getAllByText('Required')).toHaveLength(2)
    })
    expect(screen.queryByText('Enter a valid email address.')).toBeNull()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Start secure intake' }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    })
  })

  it('links each message to its field for screen readers', async () => {
    const user = userEvent.setup()
    render(<PublicIntakeStartForm siteKey={SITE_KEY} />)

    await user.click(screen.getByRole('button', { name: 'Start secure intake' }))

    const email = await screen.findByLabelText('Email address')
    await waitFor(() => {
      expect(email.getAttribute('aria-invalid')).toBe('true')
    })
    expect(email.getAttribute('aria-describedby')).toBe('public-intake-email-error')

    // The password keeps its help text and gains the error alongside it.
    expect(screen.getByLabelText('Create password').getAttribute('aria-describedby')).toBe(
      'public-intake-password-help public-intake-password-error',
    )
  })

  it('registers the client once every field and the security check pass', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    render(<PublicIntakeStartForm siteKey={SITE_KEY} />)

    await user.type(screen.getByLabelText('Full name'), '  Ada Lovelace  ')
    await user.type(screen.getByLabelText('Email address'), 'ada@example.com')
    await user.type(screen.getByLabelText('Phone number'), '5555555555')
    await user.type(screen.getByLabelText('Create password'), 'longenough')
    await user.type(screen.getByLabelText('Confirm password'), 'longenough')
    await user.click(screen.getByRole('button', { name: 'Pass security check' }))
    await user.click(screen.getByRole('button', { name: 'Start secure intake' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/intake/register')
    expect(JSON.parse(String(init?.body))).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '(555) 555-5555',
      password: 'longenough',
      turnstileToken: 'turnstile-token',
    })
  })
})
