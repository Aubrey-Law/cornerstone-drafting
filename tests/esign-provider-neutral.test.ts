import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createFirmaWebhookAdapter } from '@/lib/esign/webhookAdapter'
import { primaryEvidenceArtifact, type EsignArtifact } from '@/lib/esign/types'

function neutralMigration(): string {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(dir).filter(name => name.endsWith('_esign_provider_neutral.sql'))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(dir, matches[0]), 'utf8').toLowerCase()
}

const SECRET = 'current-secret'

function signed(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)): Headers {
  const digest = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')
  return new Headers({ 'x-firma-signature': `t=${at},v1=${digest}` })
}

describe('Firma webhook adapter', () => {
  const adapter = createFirmaWebhookAdapter({ secret: SECRET, previousSecret: 'old-secret' })

  it('verifies the timestamped HMAC over the exact raw body', () => {
    const body = JSON.stringify({ id: 'evt_1', data: { signing_request: { id: 'req_1' } } })
    expect(adapter.verify(body, signed(body))).toBe(true)
    // A single trailing byte changes the digest — the raw body is what is signed.
    expect(adapter.verify(`${body} `, signed(body))).toBe(false)
    expect(adapter.verify(body, signed(body, 'wrong-secret'))).toBe(false)
    expect(adapter.verify(body, new Headers())).toBe(false)
  })

  it('accepts the rotation header only with the configured previous secret', () => {
    const body = JSON.stringify({ id: 'evt_1', data: {} })
    const at = Math.floor(Date.now() / 1000)
    const oldDigest = createHmac('sha256', 'old-secret').update(`${at}.${body}`).digest('hex')
    const headers = new Headers({
      'x-firma-signature': 't=1,v1=' + '0'.repeat(64),
      'x-firma-signature-old': `t=${at},v1=${oldDigest}`,
    })
    expect(adapter.verify(body, headers)).toBe(true)

    const withoutPrevious = createFirmaWebhookAdapter({ secret: SECRET })
    expect(withoutPrevious.verify(body, headers)).toBe(false)
  })

  it('parses the nested signing-request payload into identifiers only', () => {
    const body = JSON.stringify({
      id: 'evt_9',
      type: 'signing_request.completed',
      data: { signing_request: { id: 'req_9' } },
    })
    expect(adapter.parse(body, new Headers())).toEqual({
      provider: 'firma',
      externalEventId: 'evt_9',
      externalRequestId: 'req_9',
      eventType: 'signing_request.completed',
    })
  })

  it('still reads the older flat payload shape', () => {
    const body = JSON.stringify({ id: 'evt_10', event_type: 'signing_request.sent', data: { id: 'req_10' } })
    const hint = adapter.parse(body, new Headers())
    expect(hint.externalRequestId).toBe('req_10')
    expect(hint.eventType).toBe('signing_request.sent')
  })

  it('prefers the event-type header over the body', () => {
    const body = JSON.stringify({ id: 'evt_11', type: 'from.body', data: { id: 'req_11' } })
    const hint = adapter.parse(body, new Headers({ 'x-firma-event': 'from.header' }))
    expect(hint.eventType).toBe('from.header')
  })

  it('reports missing identifiers as null rather than inventing them', () => {
    const hint = adapter.parse(JSON.stringify({ data: {} }), new Headers())
    expect(hint.externalEventId).toBeNull()
    expect(hint.externalRequestId).toBeNull()
  })
})

describe('evidence artifact selection', () => {
  const signedPdf: EsignArtifact = { kind: 'signed_pdf', url: 'a', mimeType: 'application/pdf' }
  const certificate: EsignArtifact = { kind: 'audit_certificate', url: 'b', mimeType: 'application/pdf' }
  const combined: EsignArtifact = { kind: 'combined_evidence', url: 'c', mimeType: 'application/pdf' }

  it('prefers the combined evidence PDF — it is the one file a court is shown', () => {
    expect(primaryEvidenceArtifact([signedPdf, certificate, combined])).toBe(combined)
  })

  it('falls back to the signed document when there is no combined file', () => {
    expect(primaryEvidenceArtifact([certificate, signedPdf])).toBe(signedPdf)
  })

  it('never returns a bare audit certificate as the agreement', () => {
    expect(primaryEvidenceArtifact([certificate])).toBeNull()
  })

  it('treats an absent list as "not ready yet" instead of throwing', () => {
    // A provider adapter may omit the key entirely; the evidence path must
    // defer rather than 500.
    expect(primaryEvidenceArtifact([])).toBeNull()
    expect(primaryEvidenceArtifact(undefined)).toBeNull()
    expect(primaryEvidenceArtifact(null)).toBeNull()
  })
})

describe('provider-neutral migration', () => {
  const sql = neutralMigration()

  it('adds generic provider identity and backfills it from the Firma columns', () => {
    expect(sql).toContain("add column if not exists provider text not null default 'firma'")
    expect(sql).toContain('add column if not exists external_request_id text')
    expect(sql).toContain('set external_request_id = firma_request_id')
    expect(sql).toContain('set external_recipient_id = firma_recipient_id')
  })

  it('keeps the Firma columns for the compatibility window', () => {
    // Dropping them needs a production data audit; a drop here would break the
    // previous release, which still writes them.
    expect(sql).not.toContain('drop column')
    expect(sql).not.toContain('drop table')
  })

  it('keys webhook idempotency on (provider, event_id)', () => {
    expect(sql).toContain('unique (provider, event_id)')
    expect(sql).toContain('on conflict (provider, event_id) do update')
    expect(sql).toContain('create or replace function public.claim_esign_webhook_event')
    expect(sql).toContain("interval '5 minutes'")
  })

  it('restricts the claim RPC to the service role', () => {
    expect(sql).toContain("auth.role() <> 'service_role'")
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
  })

  it('does not collide unsent agreements on the new unique index', () => {
    // Every draft has a null external_request_id; a non-partial unique index
    // would let only one un-sent agreement exist per provider.
    expect(sql).toContain('where external_request_id is not null')
  })

  it('stores evidence metadata with its hash and size', () => {
    expect(sql).toContain('create table if not exists public.engagement_esign_artifacts')
    expect(sql).toContain('sha256 text not null')
    expect(sql).toContain('byte_size bigint not null')
    expect(sql).toContain("kind in ('signed_pdf', 'audit_certificate', 'combined_evidence')")
  })

  it('enables RLS on both new tables with a staff policy', () => {
    expect(sql).toContain('alter table public.esign_webhook_events enable row level security')
    expect(sql).toContain('alter table public.engagement_esign_artifacts enable row level security')
    expect(sql).toContain('create policy "staff manage esign webhook events"')
    expect(sql).toContain('create policy "staff manage engagement esign artifacts"')
    // Public surfaces go through the service role behind their own checks;
    // no table in this repo grants anon.
    expect(sql).not.toContain('to anon')
  })

  it('is replay-safe', () => {
    expect(sql).toContain('add column if not exists')
    expect(sql).toContain('create table if not exists')
    expect(sql).toContain('create unique index if not exists')
    expect(sql).toContain('drop policy if exists')
  })
})
