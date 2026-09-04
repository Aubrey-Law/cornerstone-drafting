import { describe, expect, it } from 'vitest'
import { scrubEvent, sentryOptions } from '@/lib/sentry/scrub'

/**
 * Estate-planning data flows through this app: intake answers, design-sheet
 * submissions, client names and addresses. An error report that carries a
 * request body carries privileged client material to a third party, so the
 * scrubbing is not a preference and it is tested rather than trusted.
 */
describe('scrubEvent', () => {
  it('removes the request body, cookies, headers and query string', () => {
    const scrubbed = scrubEvent({
      request: {
        url: 'https://workbench.test/api/staff/matters',
        method: 'POST',
        data: { ssn: '123-45-6789' },
        cookies: { 'sb-access-token': 'secret' },
        headers: { authorization: 'Bearer secret' },
        query_string: 'client=Smith',
      },
    })
    expect(scrubbed.request).toEqual({
      url: 'https://workbench.test/api/staff/matters',
      method: 'POST',
    })
  })

  it('removes the user identifier', () => {
    const scrubbed = scrubEvent({ user: { id: 'u-1', email: 'client@example.com' } })
    expect(scrubbed.user).toBeUndefined()
  })

  it('keeps the exception, which is the reason the event exists', () => {
    const event = { exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] } }
    expect(scrubEvent({ ...event }).exception).toEqual(event.exception)
  })

  it('tolerates an event with no request or user', () => {
    expect(() => scrubEvent({})).not.toThrow()
  })
})

describe('sentryOptions', () => {
  it('never sends default PII', () => {
    expect(sentryOptions('https://key@sentry.test/1').sendDefaultPii).toBe(false)
  })

  it('scrubs through beforeSend', () => {
    const options = sentryOptions('https://key@sentry.test/1')
    const result = options.beforeSend?.({ type: undefined, user: { id: 'u-1' } })
    expect(result?.user).toBeUndefined()
  })

  it('samples no traces unless asked', () => {
    expect(sentryOptions('https://key@sentry.test/1').tracesSampleRate).toBe(0)
  })

  it('marks the release and environment so a report can be placed', () => {
    const options = sentryOptions('https://key@sentry.test/1', {
      SENTRY_ENVIRONMENT: 'production',
      VERCEL_GIT_COMMIT_SHA: 'abc123',
    })
    expect(options.environment).toBe('production')
    expect(options.release).toBe('abc123')
  })
})
