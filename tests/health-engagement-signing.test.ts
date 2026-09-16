import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isEngagementApprovalConfigured } from '@/lib/engagement/approvalConfig'

/**
 * ENGAGEMENT_APPROVAL_SECRET went unset in production for months. Nothing asked
 * for it: the agreement workspace is its only caller, and production had only
 * ever used the legacy template flow, which does not pass through approval. It
 * surfaced when someone finally walked the workspace by hand and got a bare
 * "not configured" at the approve step.
 *
 * The readiness probe asks now. These pin that it can actually answer "no" — a
 * check that cannot fail would reproduce the original problem while looking
 * like a fix for it.
 */

const original = process.env.ENGAGEMENT_APPROVAL_SECRET

beforeEach(() => { delete process.env.ENGAGEMENT_APPROVAL_SECRET })
afterEach(() => {
  if (original === undefined) delete process.env.ENGAGEMENT_APPROVAL_SECRET
  else process.env.ENGAGEMENT_APPROVAL_SECRET = original
})

describe('engagement approval configuration', () => {
  it('reports absent when the secret is unset', () => {
    expect(isEngagementApprovalConfigured()).toBe(false)
  })

  it('reports absent when the secret is only whitespace', () => {
    // approval.ts trims before use, so whitespace is as unusable as nothing.
    process.env.ENGAGEMENT_APPROVAL_SECRET = '   '
    expect(isEngagementApprovalConfigured()).toBe(false)
  })

  it('reports present when the secret is set', () => {
    process.env.ENGAGEMENT_APPROVAL_SECRET = 'long-enough-to-be-a-real-hmac-key'
    expect(isEngagementApprovalConfigured()).toBe(true)
  })
})

describe('the health route wires it in', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/health/route.ts'), 'utf8')

  it('reports the check and gates readiness on it', () => {
    expect(route).toContain('isEngagementApprovalConfigured')
    expect(route).toContain('engagementSigning:')
  })

  it('names the variable in the failure detail', () => {
    // The variable name is the entire remedy for whoever reads the probe. The
    // check is no longer importable — a route file may only export handlers —
    // so this is what keeps the message itself covered.
    expect(route).toContain('ENGAGEMENT_APPROVAL_SECRET is not set')
  })

  it('exports only what a Next.js route may export', () => {
    // Exporting a helper to make it testable is what broke the build; `next
    // build` enforces this and `npm run typecheck` does not.
    const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)]
      .map(m => m[1])
    expect(exported).toEqual(['GET'])
  })
})
