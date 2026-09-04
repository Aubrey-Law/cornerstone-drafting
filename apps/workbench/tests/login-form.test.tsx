// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
// vi.mock is hoisted above these imports, so LoginForm resolves against the
// mocked router and Supabase client.
import { LoginForm } from '@/app/auth/login/LoginForm'

const replace = vi.fn()
const refresh = vi.fn()
const signInWithPassword = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => searchParams,
}))
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({ auth: { signInWithPassword } }),
}))



beforeEach(() => {
  replace.mockReset()
  refresh.mockReset()
  signInWithPassword.mockReset()
  searchParams = new URLSearchParams()
})
afterEach(cleanup)

const submit = (email = 'attorney@example.com', password = 'Password123!') => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('the login form', () => {
  it('signs in and lands on the home the proxy will route from', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
    render(<LoginForm />)
    submit()
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'attorney@example.com',
      password: 'Password123!',
    }))
    // The form does not decide where a role belongs — the gate does. Sending
    // everyone to '/' and letting the proxy redirect keeps that rule in one place.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(refresh).toHaveBeenCalled()
  })

  it('passes a remembered destination through, for the gate to accept or ignore', async () => {
    searchParams = new URLSearchParams('redirectTo=%2Fmatters%2Fabc')
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
    render(<LoginForm />)
    submit()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/matters/abc'))
  })

  it('reports a rejected sign-in without saying which half was wrong', async () => {
    // The shape supabase-js actually returns for a bad password.
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
    })
    render(<LoginForm />)
    submit()
    // "No account with that email" would confirm which addresses exist.
    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password is incorrect/i)
    expect(replace).not.toHaveBeenCalled()
  })

  it('explains a signed-in session that has no role, rather than looping', async () => {
    // The gate passes this case through to the page precisely so it can be said
    // out loud; without a message the user sees a login form they just used.
    searchParams = new URLSearchParams('error=no_role')
    render(<LoginForm />)
    expect(screen.getByRole('alert')).toHaveTextContent(/no role/i)
  })

  it('disables the button while the request is in flight', async () => {
    let release: (v: unknown) => void = () => {}
    signInWithPassword.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<LoginForm />)
    submit()
    const button = screen.getByRole('button', { name: /signing in/i })
    expect(button).toBeDisabled()
    release({ data: { user: { id: 'u-1' } }, error: null })
    await waitFor(() => expect(replace).toHaveBeenCalled())
  })

  it('requires both fields before calling out', () => {
    render(<LoginForm />)
    expect(screen.getByLabelText(/email/i)).toBeRequired()
    expect(screen.getByLabelText(/password/i)).toBeRequired()
  })
})

describe('the login form when the auth service is unreachable', () => {
  it('says so, rather than blaming the password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    })
    render(<LoginForm />)
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not reach/i)
    expect(alert).not.toHaveTextContent(/incorrect/i)
  })

  it('lets the user try again after a failure', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 400 } })
    render(<LoginForm />)
    submit()
    await screen.findByRole('alert')
    // A button left disabled after a failed attempt is a dead form.
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
  })
})
