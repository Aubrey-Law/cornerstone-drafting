import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A signing session belongs to exactly one thing.
 *
 * 20261212000000_signature_requests gave esign_signing_sessions and
 * esign_audit_events a second possible owner so an uploaded PDF can be signed,
 * and an XOR check to keep "exactly one" true. That check is the only thing
 * standing between the two flows: a session with both owners would seal marks
 * onto one document and file the evidence against another, and a session with
 * neither cannot be signed onto anything at all.
 *
 * No mock enforces a check constraint, which is why this lives here. The same
 * lesson as the foreign key that made this suite necessary.
 */

const target = new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if (!['postgres:', 'postgresql:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('Explicit local Postgres fixture required')
}

function sql(query: string): string {
  return execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: target.hostname,
      PGPORT: target.port,
      PGUSER: decodeURIComponent(target.username),
      PGPASSWORD: decodeURIComponent(target.password),
      PGDATABASE: target.pathname.slice(1),
    },
  }).trim()
}

const intakeId = randomUUID()
const matterId = randomUUID()
const agreementId = randomUUID()
const requestId = randomUUID()

beforeAll(() => {
  sql(`insert into public.client_intake(id) values ('${intakeId}')`)
  sql(`insert into public.matters(id, client_intake_id) values ('${matterId}', '${intakeId}')`)
  sql(`insert into public.engagement_agreements(id, matter_id) values ('${agreementId}', '${matterId}')`)
  sql(`insert into public.signature_requests(id, matter_id, name, source_r2_key)
       values ('${requestId}', '${matterId}', 'HIPAA Authorization', 'matters/x/firm/hipaa.pdf')`)
})

afterAll(() => {
  sql(`delete from public.matters where id = '${matterId}'`)
  sql(`delete from public.client_intake where id = '${intakeId}'`)
})

function session(columns: string, values: string): void {
  sql(`insert into public.esign_signing_sessions(${columns}, recipient_key, token_hash, expires_at)
       values (${values}, 'k-${randomUUID()}', '${randomUUID()}', now() + interval '7 days')`)
}

describe('a signing session has exactly one owner', () => {
  it('accepts an engagement agreement', () => {
    expect(() => session('agreement_id', `'${agreementId}'`)).not.toThrow()
  })

  it('accepts an uploaded document', () => {
    expect(() => session('signature_request_id', `'${requestId}'`)).not.toThrow()
  })

  it('refuses a session that owns nothing', () => {
    // Nothing to seal onto, and no document the evidence describes.
    expect(() => sql(
      `insert into public.esign_signing_sessions(recipient_key, token_hash, expires_at)
       values ('orphan', '${randomUUID()}', now() + interval '7 days')`,
    )).toThrow(/esign_signing_sessions_owner_check/)
  })

  it('refuses a session that claims both', () => {
    // The dangerous one: marks land on one document, the audit trail files
    // against the other, and both look complete.
    expect(() => session(
      'agreement_id, signature_request_id',
      `'${agreementId}', '${requestId}'`,
    )).toThrow(/esign_signing_sessions_owner_check/)
  })

  it('keeps one live session per recipient on each side', () => {
    const key = `dup-${randomUUID()}`
    const insert = (owner: string, id: string) => sql(
      `insert into public.esign_signing_sessions(${owner}, recipient_key, token_hash, expires_at)
       values ('${id}', '${key}', '${randomUUID()}', now() + interval '7 days')`,
    )
    // The agreement side keeps its original table constraint; the document side
    // needs its own partial index, because a nullable agreement_id makes the
    // original one vacuous for document rows.
    insert('agreement_id', agreementId)
    expect(() => insert('agreement_id', agreementId)).toThrow(/recipient_key/)
    insert('signature_request_id', requestId)
    expect(() => insert('signature_request_id', requestId)).toThrow(/recipient_key/)
  })
})

describe('audit events carry the same rule', () => {
  it('refuses an event that owns nothing', () => {
    expect(() => sql(
      `insert into public.esign_audit_events(event_type) values ('sent')`,
    )).toThrow(/esign_audit_events_owner_check/)
  })
})

describe('the ceremony attestation', () => {
  it('cannot be recorded by halves', () => {
    // Who attested and when are one fact. Half of it is not evidence.
    expect(() => sql(
      `update public.signature_requests set ceremony_attested_at = now() where id = '${requestId}'`,
    )).toThrow(/signature_requests_attestation_complete/)
  })

  it('is required before anything is sent', () => {
    // The check is the last line of defence, not the UI. G.L. c. 190B documents
    // must not reach a signer through this path.
    expect(() => sql(
      `update public.signature_requests set status = 'sent' where id = '${requestId}'`,
    )).toThrow(/signature_requests_sendable/)
  })
})
