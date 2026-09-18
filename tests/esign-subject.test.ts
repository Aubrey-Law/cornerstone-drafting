import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  documentAnchorMarkers,
  resolveSigningSubject,
  signedPdfKey,
  signingPdfKey,
} from '@/lib/esign/subject'
import { engagementAnchorMarkers } from '@/lib/engagement/anchors'
import { sealFieldsFor } from '@/lib/esign/sealFields'

/**
 * The seam that lets something other than an engagement agreement be signed.
 *
 * A session names exactly one owner and this resolves it to what the signing
 * path needs. The properties worth pinning are the ones whose failure is
 * silent: a marker namespace that collides, a position that shifts, or a
 * subject that resolves to nothing and signs onto the wrong document.
 */

const tables = vi.hoisted(() => ({
  engagement_agreement_recipients: [] as Record<string, unknown>[],
  signature_requests: null as Record<string, unknown> | null,
  signature_request_recipients: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.maybeSingle = vi.fn(async () => ({
        data: tables.signature_requests,
        error: tables.error,
      }))
      chain.order = vi.fn(async () => ({
        data:
          table === 'engagement_agreement_recipients'
            ? tables.engagement_agreement_recipients
            : tables.signature_request_recipients,
        error: tables.error,
      }))
      return chain
    },
  }),
}))

beforeEach(() => {
  tables.engagement_agreement_recipients = [
    { name: 'Walter White', email: 'walter@example.com', role: 'primary', recipient_order: 1 },
    { name: 'Skylar White', email: 'skylar@example.com', role: 'spouse', recipient_order: 2 },
  ]
  tables.signature_requests = { id: 'req-1', name: 'HIPAA Authorization' }
  tables.signature_request_recipients = [
    { name: 'Walter White', email: 'walter@example.com', recipient_key: 'signer_1', recipient_order: 1 },
  ]
  tables.error = null
})

describe('marker namespaces', () => {
  it('keeps documents out of the engagement template namespace', () => {
    // An uploaded PDF could itself contain a pasted engagement template. Two
    // copies of one marker make locateAnchors throw marker_duplicated, which is
    // the good outcome; a marker resolving to the wrong place is the bad one.
    expect(documentAnchorMarkers(1).signature).toBe('[[SIGN_1_SIGNATURE]]')
    expect(documentAnchorMarkers(2).date).toBe('[[SIGN_2_DATE]]')
    expect(documentAnchorMarkers(1).signature).not.toBe(engagementAnchorMarkers(1).signature)
    expect(documentAnchorMarkers(1).date).not.toBe(engagementAnchorMarkers(1).date)
  })

  it('numbers by position, like the engagement markers do', () => {
    // Never by role. The spouse is position 2 on both sides.
    expect(documentAnchorMarkers(2).signature).toContain('_2_')
  })
})

describe('R2 layout', () => {
  it('is the layout the signing route reconstructs', () => {
    // The route rebuilds these from the owner id rather than storing them, so
    // they are a contract between writer and reader.
    expect(signingPdfKey('abc')).toBe('esign/abc/agreement.pdf')
    expect(signedPdfKey('abc')).toBe('esign/abc/signed.pdf')
  })
})

describe('resolveSigningSubject', () => {
  it('resolves an engagement agreement, in recipient order', async () => {
    const subject = await resolveSigningSubject({ agreement_id: 'agreement-1' })

    expect(subject.kind).toBe('engagement')
    expect(subject.ownerColumn).toBe('agreement_id')
    expect(subject.pdfKey).toBe('esign/agreement-1/agreement.pdf')
    expect(subject.recipients.map(r => [r.position, r.key])).toEqual([[1, 'primary'], [2, 'spouse']])
    expect(subject.markersFor(2).signature).toBe('[[CLIENT_2_SIGNATURE]]')
    expect(subject.label).toBe('engagement agreement')
  })

  it('resolves an uploaded document, keyed on its own recipients', async () => {
    const subject = await resolveSigningSubject({ agreement_id: null, signature_request_id: 'req-1' })

    expect(subject.kind).toBe('document')
    expect(subject.ownerColumn).toBe('signature_request_id')
    expect(subject.pdfKey).toBe('esign/req-1/agreement.pdf')
    expect(subject.recipients).toEqual([
      { position: 1, key: 'signer_1', name: 'Walter White', email: 'walter@example.com' },
    ])
    expect(subject.markersFor(1).signature).toBe('[[SIGN_1_SIGNATURE]]')
    // The label reaches the email subject and the audit certificate.
    expect(subject.label).toBe('HIPAA Authorization')
  })

  it('refuses a session that owns nothing', async () => {
    // The database will not produce this — esign_signing_sessions_owner_check
    // requires exactly one owner — but a session with no subject must never
    // resolve to a default, because the default would be somebody's document.
    await expect(resolveSigningSubject({ agreement_id: null })).rejects.toThrow(/belongs to no document/i)
  })

  it('refuses when the document row has gone', async () => {
    tables.signature_requests = null
    await expect(resolveSigningSubject({ agreement_id: null, signature_request_id: 'req-1' }))
      .rejects.toThrow(/belongs to no document/i)
  })
})

describe('sealFieldsFor marker injection', () => {
  const mark = { position: 1, signedAt: new Date('2026-09-18T12:00:00Z'), typedName: 'Walter White' }

  it('still defaults to the engagement markers', () => {
    // Every existing caller passes two arguments. If this default ever moved,
    // engagement sealing would look for markers no template contains.
    expect(sealFieldsFor([mark], 'America/New_York').map(f => f.marker))
      .toEqual(['[[CLIENT_1_SIGNATURE]]', '[[CLIENT_1_DATE]]'])
  })

  it('uses the namespace it is given', () => {
    expect(sealFieldsFor([mark], 'America/New_York', documentAnchorMarkers).map(f => f.marker))
      .toEqual(['[[SIGN_1_SIGNATURE]]', '[[SIGN_1_DATE]]'])
  })
})
