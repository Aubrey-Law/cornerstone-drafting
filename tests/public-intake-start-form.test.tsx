/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PublicIntakeStartForm } from '@/app/intake/start/PublicIntakeStartForm'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: vi.fn() } },
}))

afterEach(cleanup)

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
})
