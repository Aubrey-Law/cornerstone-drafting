import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyFirmaWebhookSignature } from '@/lib/esign/verify'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function firmaClaimMigration(): string {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('_firma_webhook_event_claim.sql'))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(migrationsDir, matches[0]), 'utf8').toLowerCase()
}

const payload = JSON.stringify({ id: 'evt_123', data: { id: 'req_123' } })
const nowMs = 1_750_000_000_000
const timestamp = Math.floor(nowMs / 1000)

function firmaSignature(secret: string, body = payload, signedAt = timestamp): string {
  const signature = createHmac('sha256', secret)
    .update(`${signedAt}.${body}`)
    .digest('hex')
  return `t=${signedAt},v1=${signature}`
}

describe('Firma webhook signature verification', () => {
  it('accepts a valid timestamped HMAC for the raw body', () => {
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('current-secret'),
      secret: 'current-secret',
      nowMs,
    })).toBe(true)
  })

  it('accepts the old signature header only with the configured previous secret', () => {
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('wrong-current-secret'),
      oldSignatureHeader: firmaSignature('previous-secret'),
      secret: 'current-secret',
      previousSecret: 'previous-secret',
      nowMs,
    })).toBe(true)
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('wrong-current-secret'),
      oldSignatureHeader: firmaSignature('previous-secret'),
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
  })

  it('rejects body tampering, wrong secrets, and missing values', () => {
    expect(verifyFirmaWebhookSignature({
      payload: `${payload} `,
      signatureHeader: firmaSignature('current-secret'),
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('another-secret'),
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: null,
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('current-secret'),
      secret: '',
      nowMs,
    })).toBe(false)
  })

  it('rejects stale and implausibly future timestamps', () => {
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('current-secret', payload, timestamp - 301),
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
    expect(verifyFirmaWebhookSignature({
      payload,
      signatureHeader: firmaSignature('current-secret', payload, timestamp + 301),
      secret: 'current-secret',
      nowMs,
    })).toBe(false)
  })

  it('rejects malformed or ambiguous signature headers', () => {
    const valid = firmaSignature('current-secret')
    const digest = valid.split('v1=')[1]
    for (const signatureHeader of [
      '',
      `v1=${digest}`,
      `t=${timestamp}`,
      `t=nope,v1=${digest}`,
      `t=${timestamp},v1=not-hex`,
      `t=${timestamp},t=${timestamp},v1=${digest}`,
      `t=${timestamp},v1=${digest},v1=${digest}`,
      `t=${timestamp},v1=${digest},extra=value`,
    ]) {
      expect(verifyFirmaWebhookSignature({
        payload,
        signatureHeader,
        secret: 'current-secret',
        nowMs,
      })).toBe(false)
    }
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

  it('supports a spouse (second signer) via the joint template', () => {
    expect(source).toContain('FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT')
    expect(source).toContain('jointTemplateId')
    // The spouse is added as the second signer (order 2).
    expect(source).toMatch(/toRecipient\(input\.spouse, 2\)/)
  })
})

describe('in-app sign now', () => {
  it('lead engagement route returns the signing link', () => {
    const source = read('app/api/admin/leads/[id]/engagement/route.ts')
    expect(source).toContain('signingLink')
  })

  it('leads client opens a signing iframe on close', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('<iframe')
    expect(source).toContain('closeSigning')
  })

  it('the send-engagement dialog offers an in-person Sign now action', () => {
    const source = read('app/admin/leads/SendEngagementDialog.tsx')
    expect(source).toContain('Sign now')
    expect(source).toContain('onSignNow')
  })
})

describe('esign webhook route source shape', () => {
  const source = read('app/api/webhooks/esign/route.ts')

  it('runs on node with dynamic rendering', () => {
    expect(source).toContain("runtime = 'nodejs'")
    expect(source).toContain("dynamic = 'force-dynamic'")
  })

  it('gates on the timestamped HMAC signature before parsing JSON', () => {
    expect(source).toContain('FIRMA_WEBHOOK_SECRET')
    expect(source).toContain('verifyFirmaWebhookSignature')
    expect(source).toContain("req.headers.get('x-firma-signature')")
    expect(source).toContain("req.headers.get('x-firma-signature-old')")
    expect(source.indexOf('await req.text()')).toBeLessThan(source.indexOf('JSON.parse(rawBody)'))
    expect(source.indexOf('verifyFirmaWebhookSignature')).toBeLessThan(source.indexOf('JSON.parse(rawBody)'))
    expect(source).not.toContain("searchParams.get('secret')")
    expect(source).toContain('503')
    expect(source).toContain('401')
  })

  it('treats the payload as a hint and re-fetches provider state', () => {
    expect(source).toContain('getEnvelopeState')
    expect(source).toContain('engagement_envelope_id')
  })

  it('stores the signed pdf and flips the engagement flag last', () => {
    expect(source).toContain('putFileToR2')
    expect(source).toContain("source: 'firm'")
    expect(source).toContain('shared_at: new Date().toISOString()')
    expect(source).toContain('engagement_signed: true')
    expect(source).toContain('uploaded_by: null')
    expect(source).toContain('duplicate')
  })

  it('claims the official event id atomically before fetching provider state', () => {
    expect(source).toContain('payload.id')
    expect(source).toContain('data.signing_request')
    expect(source).toContain("req.headers.get('x-firma-event')")
    expect(source).toContain("rpc('claim_firma_webhook_event'")
    expect(source.indexOf("rpc('claim_firma_webhook_event'"))
      .toBeLessThan(source.indexOf('getEnvelopeState'))
    expect(source.indexOf("rpc('claim_firma_webhook_event'"))
      .toBeLessThan(source.indexOf('if (agreement)'))
    expect(source).toContain("claimStatus === 'in_progress'")
    expect(source).toContain('{ status: 503 }')
    expect(source).toContain('markFirmaWebhookFailed')
    expect(source).toContain('markFirmaWebhookProcessed')
    expect(source).not.toContain("createHash('sha256')")
    expect(source).not.toContain("req.headers.get('x-firma-delivery')")
    expect(source).not.toContain("select('id, processed_at')")
    expect(source).not.toContain("eventInsertError.code !== '23505'")
  })
})

describe('Firma webhook event claim migration', () => {
  it('atomically claims new, failed, or stale events for service-role processing', () => {
    const sql = firmaClaimMigration()

    expect(sql).toContain('processing_started_at timestamptz')
    expect(sql).toContain('create or replace function public.claim_firma_webhook_event')
    expect(sql).toContain('on conflict (event_id) do update')
    expect(sql).toContain("interval '5 minutes'")
    expect(sql).toContain('firma_webhook_events.error is not null')
    expect(sql).toContain("auth.role() <> 'service_role'")
    expect(sql).toContain(
      'revoke execute on function public.claim_firma_webhook_event(text, text, text, jsonb, uuid)\n  from public, anon, authenticated',
    )
    expect(sql).toContain(
      'grant execute on function public.claim_firma_webhook_event(text, text, text, jsonb, uuid)\n  to service_role',
    )
  })
})
