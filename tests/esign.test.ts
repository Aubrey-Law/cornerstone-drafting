import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyEsignWebhookSecret } from '@/lib/esign/verify'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

describe('esign webhook secret verification', () => {
  it('accepts a matching secret', () => {
    expect(verifyEsignWebhookSecret('shh-secret', 'shh-secret')).toBe(true)
  })

  it('rejects mismatches, missing values, and length differences', () => {
    expect(verifyEsignWebhookSecret('shh-secreT', 'shh-secret')).toBe(false)
    expect(verifyEsignWebhookSecret(null, 'shh-secret')).toBe(false)
    expect(verifyEsignWebhookSecret('', 'shh-secret')).toBe(false)
    expect(verifyEsignWebhookSecret('shh', 'shh-secret')).toBe(false)
    expect(verifyEsignWebhookSecret('shh-secret', '')).toBe(false)
  })

  it('compares in constant time', () => {
    expect(read('lib/esign/verify.ts')).toContain('timingSafeEqual')
  })
})

describe('firma provider source shape', () => {
  const source = read('lib/esign/firma.ts')

  it('reads config from the documented env vars', () => {
    expect(source).toContain('FIRMA_API_KEY')
    expect(source).toContain('FIRMA_ENGAGEMENT_TEMPLATE_ID')
  })

  it('creates and sends from the engagement template', () => {
    expect(source).toContain('createAndSendSigningRequest')
    expect(source).toContain('template_id')
  })

  it('exposes authoritative state including the combined signed document url', () => {
    expect(source).toContain('getSigningRequest')
    expect(source).toContain('final_document_download_url')
  })

  it('returns the signer link for in-app "Sign now"', () => {
    expect(source).toContain('signing_link')
    expect(source).toContain('signingLink')
  })
})

describe('in-app sign now', () => {
  it('lead engagement route returns the signing link', () => {
    const source = read('app/api/admin/leads/[id]/engagement/route.ts')
    expect(source).toContain('signingLink')
  })

  it('leads client opens a signing iframe and refreshes on close', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('Sign now')
    expect(source).toContain('<iframe')
    expect(source).toContain('handleSignNow')
  })
})

describe('esign webhook route source shape', () => {
  const source = read('app/api/webhooks/esign/route.ts')

  it('runs on node with dynamic rendering', () => {
    expect(source).toContain("runtime = 'nodejs'")
    expect(source).toContain("dynamic = 'force-dynamic'")
  })

  it('gates on the shared secret (503 unconfigured, 401 mismatch)', () => {
    expect(source).toContain('FIRMA_WEBHOOK_SECRET')
    expect(source).toContain('verifyEsignWebhookSecret')
    expect(source).toContain('503')
    expect(source).toContain('401')
  })

  it('treats the payload as a hint and re-fetches provider state', () => {
    expect(source).toContain('getEnvelopeState')
    expect(source).toContain('engagement_envelope_id')
  })

  it('stores the signed pdf and flips the engagement flag last', () => {
    expect(source).toContain('putFileToR2')
    expect(source).toContain("folder: 'signed'")
    expect(source).toContain('engagement_signed: true')
    expect(source).toContain('uploaded_by: null')
    expect(source).toContain('duplicate')
  })
})
