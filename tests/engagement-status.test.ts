import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveEngagementStatus, engagementStatusLabel } from '@/lib/engagementStatus'

describe('deriveEngagementStatus', () => {
  it('returns not_sent for missing or empty details', () => {
    expect(deriveEngagementStatus(null)).toBe('not_sent')
    expect(deriveEngagementStatus({})).toBe('not_sent')
    expect(deriveEngagementStatus({ engagement_status: null })).toBe('not_sent')
  })

  it('reads the stored status column', () => {
    expect(deriveEngagementStatus({ engagement_status: 'draft' })).toBe('draft')
    expect(deriveEngagementStatus({ engagement_status: 'sent' })).toBe('sent')
    expect(deriveEngagementStatus({ engagement_status: 'signed' })).toBe('signed')
    expect(deriveEngagementStatus({ engagement_status: 'declined' })).toBe('declined')
  })

  it('falls back to the legacy boolean and timestamp columns', () => {
    expect(deriveEngagementStatus({ engagement_signed: true })).toBe('signed')
    expect(deriveEngagementStatus({ engagement_sent_at: '2026-07-01T00:00:00Z' })).toBe('sent')
  })

  it('prefers signed over stale status or timestamps', () => {
    expect(
      deriveEngagementStatus({
        engagement_signed: true,
        engagement_status: 'sent',
        engagement_sent_at: '2026-07-01T00:00:00Z',
      }),
    ).toBe('signed')
  })

  it('labels every status', () => {
    expect(engagementStatusLabel('not_sent')).toBe('Not sent')
    expect(engagementStatusLabel('draft')).toBe('Draft')
    expect(engagementStatusLabel('sent')).toBe('Sent')
    expect(engagementStatusLabel('signed')).toBe('Signed')
    expect(engagementStatusLabel('declined')).toBe('Declined')
  })
})

describe('engagement status write path source shape', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/matter-details/route.ts'),
    'utf8',
  )

  it('accepts only the dropdown statuses', () => {
    expect(route).toContain("'engagement_status'")
    expect(route).toContain("['not_sent', 'draft', 'sent', 'signed']")
    expect(route).toContain('Invalid engagement status')
  })

  it('keeps the legacy signed flag and timestamps consistent', () => {
    expect(route).toContain('engagement_signed: true')
    expect(route).toContain('engagement_signed: false')
    expect(route).toContain('engagement_signed_at: null')
  })

  it('mirrors manual status changes onto the originating lead', () => {
    expect(route).toContain('client_intake_id')
    expect(route).toContain("from('client_intake')")
  })
})

describe('engagement draft/send flows record matter status', () => {
  it('draft routes mark the matter (and lead) as draft', () => {
    const matterDraft = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/engagement-draft/route.ts'),
      'utf8',
    )
    const leadDraft = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/leads/[id]/engagement-draft/route.ts'),
      'utf8',
    )
    expect(matterDraft).toContain('markEngagementDraftStatus')
    expect(leadDraft).toContain('markEngagementDraftStatus')
    expect(leadDraft).toContain('leadId: id')
  })

  it('the workspace send flow mirrors sent status onto the matter', () => {
    const runtime = fs.readFileSync(
      path.join(process.cwd(), 'lib/engagement/runtime.ts'),
      'utf8',
    )
    expect(runtime).toContain('markEngagementSentStatus')
  })

  it('the draft marker never downgrades a sent or signed engagement', () => {
    const status = fs.readFileSync(
      path.join(process.cwd(), 'lib/engagement/status.ts'),
      'utf8',
    )
    expect(status).toContain("new Set(['sent', 'signed'])")
    expect(status).toContain('engagement_signed')
  })
})
