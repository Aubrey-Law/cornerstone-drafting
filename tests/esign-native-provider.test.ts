import { beforeEach, describe, expect, it, vi } from 'vitest'
import { putFileToR2 } from '@/lib/documentUpload'
import { createNativeEsignProvider, esignNativeEnabled } from '@/lib/esign/native'
import type { EsignProvider } from '@/lib/esign/types'

/**
 * The native provider's job is to satisfy the same seam Firma does, so
 * selecting it is one line. These tests pin the parts that would otherwise
 * fail only in production: the flag, the refusal to serve a flow it cannot,
 * and the fact that a signing link is never recoverable after it is sent.
 */

const state = vi.hoisted(() => ({
  firmSettings: { esign_native_enabled: false } as Record<string, unknown> | null,
  settingsError: null as { message: string } | null,
  upserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.in = vi.fn(() => chain)
      chain.update = vi.fn(() => chain)
      chain.insert = vi.fn(async () => ({ error: null }))
      chain.upsert = vi.fn((row: Record<string, unknown>) => {
        state.upserts.push(row)
        return chain
      })
      chain.single = vi.fn(async () => ({ data: { id: 'session-1' }, error: null }))
      chain.maybeSingle = vi.fn(async () => ({ data: state.firmSettings, error: state.settingsError }))
      return chain
    },
  }),
}))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))
vi.mock('@/lib/esign/nativeAnchors', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/esign/nativeAnchors')>()),
  locateAnchors: vi.fn(async () => []),
}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({}), r2Bucket: () => 'bucket' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed') }))


beforeEach(() => {
  vi.clearAllMocks()
  state.upserts = []
  state.firmSettings = { esign_native_enabled: false }
  state.settingsError = null
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('esignNativeEnabled', () => {
  it('is off unless the firm has explicitly turned it on', async () => {
    expect(await esignNativeEnabled()).toBe(false)

    state.firmSettings = { esign_native_enabled: true }
    expect(await esignNativeEnabled()).toBe(true)
  })

  it('stays off when the setting is missing or unreadable', async () => {
    // Failing closed matters: falling back to the native path because a
    // settings read failed would silently change who signs client agreements.
    state.firmSettings = null
    expect(await esignNativeEnabled()).toBe(false)

    state.firmSettings = { esign_native_enabled: true }
    state.settingsError = { message: 'connection reset' }
    expect(await esignNativeEnabled()).toBe(false)
  })

  it('treats any non-true value as off', async () => {
    for (const value of [false, null, undefined, 'true', 1]) {
      state.firmSettings = { esign_native_enabled: value }
      expect(await esignNativeEnabled()).toBe(false)
    }
  })
})

describe('native provider contract', () => {
  const provider: EsignProvider = createNativeEsignProvider()

  it('declares itself as native with honest capabilities', () => {
    expect(provider.name).toBe('native')
    expect(provider.capabilities.resend).toBe(true)
    expect(provider.capabilities.cancel).toBe(true)
    // The audit certificate is a page inside the signed document, not a
    // separate artifact, and the signer leaves the workspace to sign.
    expect(provider.capabilities.separateAuditCertificate).toBe(false)
    expect(provider.capabilities.embeddedSigning).toBe(false)
  })

  it('refuses the legacy template flow instead of faking an envelope', async () => {
    // That flow's document lives in a vendor template; there is nothing local
    // to stamp. Returning a made-up envelope id would strand the send.
    await expect(provider.createEngagementEnvelope({
      primary: { name: 'A Client', email: 'a@example.com' },
    })).rejects.toThrow(/does not support the legacy template flow/i)
  })

  it('rejects anchors that do not match a unique recipient', async () => {
    await expect(provider.createDocumentRequest({
      agreementId: 'agreement-1',
      name: 'Engagement',
      document: Buffer.from('%PDF-1.7'),
      recipients: [
        { key: 'primary', name: 'A', email: 'a@example.com', order: 1 },
        { key: 'primary', name: 'B', email: 'b@example.com', order: 2 },
      ],
      anchors: [],
      expirationHours: 72,
      customMessage: '',
    })).rejects.toThrow(/unique recipient key/i)
  })

  it('never hands back a signing link it could reconstruct later', async () => {
    // Only the token hash is stored, so state reads cannot return a link.
    // Anything that needs one mints a fresh token and supersedes the old.
    const state = await provider.getDocumentRequestState('agreement-1')

    expect(state.recipients?.every(r => r.signingLink === null)).toBe(true)
  })

  it('keys the signing session and the stored document to the real agreement', async () => {
    // The first production send that got this far died here:
    //
    //   insert or update on table "esign_signing_sessions" violates foreign
    //   key constraint "esign_signing_sessions_agreement_id_fkey"
    //
    // The provider was minting a fresh UUID for the request and writing it
    // into agreement_id, which is a foreign key to engagement_agreements(id).
    // No invented id can satisfy that, so the native path could never create a
    // session at all. The mocked client here enforces no constraints, so the
    // assertion has to be on the value written rather than on the insert
    // succeeding.
    //
    // The R2 key matters for the same reason: app/api/sign/[token]/route.ts
    // reads the document from `esign/${session.agreement_id}/agreement.pdf`,
    // a path it can only rebuild if that is where the document was put.
    const result = await provider.createDocumentRequest({
      agreementId: 'agreement-1',
      name: 'Engagement',
      document: Buffer.from('%PDF-1.7'),
      recipients: [
        { key: 'primary', name: 'A', email: 'a@example.com', order: 1 },
        { key: 'spouse', name: 'B', email: 'b@example.com', order: 2 },
      ],
      anchors: [],
      expirationHours: 72,
      customMessage: '',
    })

    expect(result.requestId).toBe('agreement-1')
    expect(state.upserts).toHaveLength(2)
    expect(state.upserts.map(row => row.agreement_id)).toEqual(['agreement-1', 'agreement-1'])
    expect(state.upserts.map(row => row.recipient_key)).toEqual(['primary', 'spouse'])
    expect(vi.mocked(putFileToR2).mock.calls[0][0]).toBe('esign/agreement-1/agreement.pdf')
  })

  it('refuses a request with no agreement to belong to', async () => {
    // Better to fail naming the cause than to hand the database a row it will
    // reject with a constraint name.
    await expect(provider.createDocumentRequest({
      agreementId: '   ',
      name: 'Engagement',
      document: Buffer.from('%PDF-1.7'),
      recipients: [{ key: 'primary', name: 'A', email: 'a@example.com', order: 1 }],
      anchors: [],
      expirationHours: 72,
      customMessage: '',
    })).rejects.toThrow(/needs the agreement it belongs to/i)
  })

  it('refuses to build a signing link with no configured origin', async () => {
    // A link to nowhere, emailed to a client, is worse than a failed send.
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.CORNERSTONE_ORIGIN

    await expect(provider.createDocumentRequest({
      agreementId: 'agreement-1',
      name: 'Engagement',
      document: Buffer.from('%PDF-1.7'),
      recipients: [{ key: 'primary', name: 'A', email: 'a@example.com', order: 1 }],
      anchors: [],
      expirationHours: 72,
      customMessage: '',
    })).rejects.toThrow()
  })
})
