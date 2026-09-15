import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkEngagementSigning } from '@/app/api/health/route'

/**
 * ENGAGEMENT_APPROVAL_SECRET went unset in production for months. Nothing asked
 * for it: the agreement workspace is the only caller, and production had only
 * ever used the legacy template flow, which does not pass through it. It
 * surfaced when someone finally walked the workspace by hand and got a bare
 * "not configured" at the approve step.
 *
 * The readiness probe now asks. These pin that it actually can answer "no" —
 * a check that cannot fail would reproduce the original problem while looking
 * like a fix for it.
 */

const original = process.env.ENGAGEMENT_APPROVAL_SECRET

beforeEach(() => { delete process.env.ENGAGEMENT_APPROVAL_SECRET })
afterEach(() => {
  if (original === undefined) delete process.env.ENGAGEMENT_APPROVAL_SECRET
  else process.env.ENGAGEMENT_APPROVAL_SECRET = original
})

describe('engagement signing readiness check', () => {
  it('fails when the secret is absent, and names it', () => {
    const result = checkEngagementSigning()
    expect(result.status).toBe('fail')
    // The variable name is the entire remedy; a detail without it sends the
    // reader back to the source to find out what to set.
    expect(result.detail).toContain('ENGAGEMENT_APPROVAL_SECRET')
  })

  it('fails when the secret is only whitespace', () => {
    process.env.ENGAGEMENT_APPROVAL_SECRET = '   '
    expect(checkEngagementSigning().status).toBe('fail')
  })

  it('passes when the secret is set', () => {
    process.env.ENGAGEMENT_APPROVAL_SECRET = 'long-enough-to-be-a-real-hmac-key'
    expect(checkEngagementSigning()).toEqual({ status: 'ok' })
  })
})
