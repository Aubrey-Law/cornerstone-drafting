import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { issueRevisionApproval, verifyRevisionApproval } from '@/lib/engagement/approval'

describe('revision approval tokens', () => {
  beforeEach(() => { process.env.ENGAGEMENT_APPROVAL_SECRET = 'test-secret-long-enough' })
  afterEach(() => { delete process.env.ENGAGEMENT_APPROVAL_SECRET })

  it('signs and verifies an approval bound to agreement, revision, and hash', () => {
    const token = issueRevisionApproval({
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123', expiresInSeconds: 60,
    })
    expect(verifyRevisionApproval(token, {
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123',
    }).ok).toBe(true)
  })

  it('rejects changed hashes and tampered signatures', () => {
    const token = issueRevisionApproval({
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123', expiresInSeconds: 60,
    })
    expect(verifyRevisionApproval(token, {
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'changed',
    }).ok).toBe(false)
    expect(verifyRevisionApproval(`${token}x`, {
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123',
    }).ok).toBe(false)
  })

  it('rejects expired approvals', () => {
    const token = issueRevisionApproval({
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123',
      expiresInSeconds: 1, now: new Date('2026-01-01T00:00:00Z'), nonce: 'fixed-nonce',
    })
    expect(verifyRevisionApproval(token, {
      agreementId: 'agreement-1', revisionId: 'revision-1', sha256: 'abc123',
      now: new Date('2026-01-01T00:00:02Z'),
    }).ok).toBe(false)
  })
})
