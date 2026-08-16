/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LoginPage from '@/app/auth/login/page'
import ResetPasswordPage from '@/app/auth/reset-password/page'
import { AuthShell } from '@/components/layout/AuthShell'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {} },
}))

afterEach(cleanup)

describe('authentication password controls', () => {
  it('lets a user reveal and conceal the sign-in password', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('type')).toBe('password')

    await user.click(screen.getByRole('button', { name: /^Show password$/ }))
    expect(password.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: /^Hide password$/ }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: /^Hide password$/ }))
    expect(password.getAttribute('type')).toBe('password')
  })

  it('explains the reset requirement and exposes both password fields', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    const password = screen.getByLabelText('New password')
    const confirmation = screen.getByLabelText('Confirm password')

    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()
    expect(password.getAttribute('aria-describedby')).toBe('new-password-help')

    await user.click(screen.getByRole('button', { name: 'Show new password' }))
    await user.click(screen.getByRole('button', { name: 'Show password confirmation' }))

    expect(password.getAttribute('type')).toBe('text')
    expect(confirmation.getAttribute('type')).toBe('text')
  })
})

describe('AuthShell logo sizing', () => {
  it('preserves the requested desktop width while capping the mobile logo', () => {
    render(<AuthShell logoWidth={220}>Content</AuthShell>)

    const homeLink = screen.getByRole('link', { name: 'Aubrey Law home' })
    expect(homeLink.style.getPropertyValue('--auth-logo-width')).toBe('220px')
    expect(homeLink.style.getPropertyValue('--auth-logo-mobile-width')).toBe('160px')
  })
})
