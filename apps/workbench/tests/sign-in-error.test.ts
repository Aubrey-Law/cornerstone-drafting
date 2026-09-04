import { describe, expect, it } from 'vitest'
import { classifySignInError, signInMessage } from '@/lib/auth/signInError'

/**
 * Telling a user their password is wrong when the auth service is unreachable
 * is worse than saying nothing: the attorney concludes their credentials
 * changed and starts resetting a password that was never the problem. So a
 * rejection has to be positively identified, and everything else is reported as
 * a service that could not be reached.
 */
describe('classifySignInError', () => {
  it.each([400, 401, 403])('reads HTTP %s as a rejected credential', (status) => {
    expect(classifySignInError({ status })).toBe('rejected')
  })

  it.each(['invalid_credentials', 'invalid_grant'])('reads code %s as a rejected credential', (code) => {
    expect(classifySignInError({ code })).toBe('rejected')
  })

  it('reads a retryable fetch failure as unavailable', () => {
    // What supabase-js raises when DNS fails or the network is down.
    expect(classifySignInError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('unavailable')
  })

  it('reads a server error as unavailable', () => {
    expect(classifySignInError({ status: 503 })).toBe('unavailable')
  })

  it('reads an unrecognised error as unavailable, not as a rejection', () => {
    // Failing this way round means an unknown fault asks the user to retry
    // rather than accusing them of a wrong password.
    expect(classifySignInError({})).toBe('unavailable')
    expect(classifySignInError(null)).toBe('unavailable')
  })
})

describe('signInMessage', () => {
  it('does not reveal whether the email has an account', () => {
    const message = signInMessage('rejected')
    expect(message).toMatch(/email or password/i)
    expect(message).not.toMatch(/no account|not found|unknown user|does not exist/i)
  })

  it('says the service could not be reached, and to try again', () => {
    expect(signInMessage('unavailable')).toMatch(/could not reach|try again/i)
  })
})
