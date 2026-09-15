import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      chain.upsert = vi.fn(() => chain)
      chain.single = vi.fn(async () => ({ data: { id: 'session-1' }, error: null }))
      chain.maybeSingle = vi.fn(async () => ({ data: state.firmSettings, error: state.settingsError }))
      return chain
    },
  }),
}))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({}), r2Bucket: () => 'bucket' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed') }))


beforeEach(() => {
  vi.clearAllMocks()
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

  it('refuses to build a signing link with no configured origin', async () => {
    // A link to nowhere, emailed to a client, is worse than a failed send.
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.CORNERSTONE_ORIGIN

    await expect(provider.createDocumentRequest({
      name: 'Engagement',
      document: Buffer.from('%PDF-1.7'),
      recipients: [{ key: 'primary', name: 'A', email: 'a@example.com', order: 1 }],
      anchors: [],
      expirationHours: 72,
      customMessage: '',
    })).rejects.toThrow()
  })
})
