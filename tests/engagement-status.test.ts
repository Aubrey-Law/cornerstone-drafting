import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveEngagementStatus,
  engagementPatchForSignedAt,
  engagementStatusLabel,
  normalizeEngagementSignedAt,
} from '@/lib/engagementStatus'

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

describe('normalizeEngagementSignedAt', () => {
  it('stores a calendar day at midday so neither formatter rolls it back', () => {
    // The facts panel reads the stamp back on the UTC calendar and the SLA
    // views read it in the firm timezone; midday is the only hour both agree on.
    expect(normalizeEngagementSignedAt('2026-08-06')).toEqual({
      ok: true,
      value: '2026-08-06T12:00:00.000Z',
    })
  })

  it('treats an empty value as clearing the date', () => {
    expect(normalizeEngagementSignedAt(null)).toEqual({ ok: true, value: null })
    expect(normalizeEngagementSignedAt('')).toEqual({ ok: true, value: null })
    expect(normalizeEngagementSignedAt('   ')).toEqual({ ok: true, value: null })
  })

  it('keeps a full timestamp from the e-sign path intact', () => {
    expect(normalizeEngagementSignedAt('2026-08-06T15:30:00.000Z')).toEqual({
      ok: true,
      value: '2026-08-06T15:30:00.000Z',
    })
  })

  it('rejects a day that does not exist rather than rolling it over', () => {
    // Date.parse turns 2026-02-31 into March 3rd; a silent roll would date the
    // engagement — and everything anchored to it — to the wrong day.
    expect(normalizeEngagementSignedAt('2026-02-31')).toEqual({ ok: false })
  })

  it('rejects anything that is not a date', () => {
    expect(normalizeEngagementSignedAt('last tuesday')).toEqual({ ok: false })
    expect(normalizeEngagementSignedAt(42)).toEqual({ ok: false })
    expect(normalizeEngagementSignedAt(true)).toEqual({ ok: false })
  })
})

describe('engagementPatchForSignedAt', () => {
  it('marks the engagement signed when a date is set', () => {
    expect(engagementPatchForSignedAt('2026-08-06T12:00:00.000Z', null)).toEqual({
      engagement_signed_at: '2026-08-06T12:00:00.000Z',
      engagement_signed: true,
      engagement_status: 'signed',
    })
  })

  it('promotes a sent engagement to signed', () => {
    expect(
      engagementPatchForSignedAt('2026-08-06T12:00:00.000Z', {
        engagement_status: 'sent',
        engagement_sent_at: '2026-07-01T00:00:00Z',
      }),
    ).toMatchObject({ engagement_signed: true, engagement_status: 'signed' })
  })

  it('un-signs the engagement when the date is cleared', () => {
    // Leaving the status at signed with nothing to show for it would keep
    // deriveEngagementStatus reporting signed forever.
    expect(
      engagementPatchForSignedAt(null, {
        engagement_status: 'signed',
        engagement_sent_at: '2026-07-01T00:00:00Z',
      }),
    ).toEqual({
      engagement_signed_at: null,
      engagement_signed: false,
      engagement_status: 'sent',
    })
  })

  it('falls back to not sent when clearing a date on a row that was never sent', () => {
    expect(engagementPatchForSignedAt(null, { engagement_status: 'signed' })).toEqual({
      engagement_signed_at: null,
      engagement_signed: false,
      engagement_status: null,
    })
  })

  it('keeps a prior draft or declined status when the date is cleared', () => {
    expect(engagementPatchForSignedAt(null, { engagement_status: 'draft' })).toMatchObject({
      engagement_status: 'draft',
    })
    expect(engagementPatchForSignedAt(null, { engagement_status: 'declined' })).toMatchObject({
      engagement_status: 'declined',
    })
  })
})

describe('engagement signed date write path source shape', () => {
  it('accepts the field the Dates panel writes', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matter-details/route.ts'),
      'utf8',
    )
    expect(route).toContain("'engagement_signed_at'")
    expect(route).toContain('normalizeEngagementSignedAt')
  })

  it('mirrors the signed date onto the originating lead', () => {
    // The Leads pipeline reads its own copy; a matter-side edit that skipped
    // the mirror would leave the two boards disagreeing.
    const sync = fs.readFileSync(path.join(process.cwd(), 'lib/engagement/signedDate.ts'), 'utf8')
    expect(sync).toContain('engagementPatchForSignedAt')
    expect(sync).toContain('mirrorEngagementToLead')
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
    expect(route).toContain('mirrorEngagementToLead')
    const sync = fs.readFileSync(path.join(process.cwd(), 'lib/engagement/signedDate.ts'), 'utf8')
    expect(sync).toContain('client_intake_id')
    expect(sync).toContain("from('client_intake')")
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
