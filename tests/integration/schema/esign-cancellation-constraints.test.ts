import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A withdrawal is expressible in the database.
 *
 * Both values this feature writes sit behind CHECK constraints, and a CHECK is
 * exactly what no mock enforces: every unit test here passes against a
 * database that would reject the insert. That is not hypothetical on this path
 * — an invented uuid written into a column with a foreign key is why this
 * suite exists at all.
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
const requestId = randomUUID()
const sessionId = randomUUID()

beforeAll(() => {
  sql(`insert into public.client_intake(id) values ('${intakeId}')`)
  sql(`insert into public.matters(id, client_intake_id) values ('${matterId}', '${intakeId}')`)
  sql(`insert into public.signature_requests(id, matter_id, name, source_r2_key)
       values ('${requestId}', '${matterId}', 'HIPAA Authorization', 'matters/x/firm/hipaa.pdf')`)
  sql(`insert into public.esign_signing_sessions(id, signature_request_id, recipient_key, token_hash, expires_at)
       values ('${sessionId}', '${requestId}', 'signer_1', '${randomUUID()}', now() + interval '7 days')`)
})

describe('a withdrawn signing session', () => {
  it('can be stored', () => {
    // Without this value the only way to close a live link is to call it
    // expired, which tells a client their clock ran out when the firm took the
    // document back.
    sql(`update public.esign_signing_sessions set status = 'cancelled' where id = '${sessionId}'`)
    expect(sql(`select status from public.esign_signing_sessions where id = '${sessionId}'`))
      .toBe('cancelled')
  })

  it('has not made the column accept anything at all', () => {
    expect(() => sql(
      `update public.esign_signing_sessions set status = 'withdrawn' where id = '${sessionId}'`,
    )).toThrow()
  })
})

describe('a cancellation audit event', () => {
  it('can be filed against the request, unattributed to any signer', () => {
    // The firm did this. An event carrying a session_id is printed against
    // that signer's name on the certificate.
    sql(`insert into public.esign_audit_events(signature_request_id, event_type, detail)
         values ('${requestId}', 'cancelled', '{"reason":"Wrong version sent"}'::jsonb)`)
    expect(sql(`select count(*) from public.esign_audit_events
                where signature_request_id = '${requestId}' and event_type = 'cancelled'
                and session_id is null`)).toBe('1')
  })

  it('leaves the vocabulary otherwise closed', () => {
    expect(() => sql(
      `insert into public.esign_audit_events(signature_request_id, event_type)
       values ('${requestId}', 'withdrawn')`,
    )).toThrow()
  })

  it('still accepts everything it accepted before', () => {
    // Widening a CHECK has to be additive: an existing writer that breaks is a
    // signing route that cannot record a signature.
    for (const event of ['sent', 'opened', 'consented', 'signed', 'declined', 'sealed', 'emailed']) {
      sql(`insert into public.esign_audit_events(signature_request_id, event_type)
           values ('${requestId}', '${event}')`)
    }
    expect(sql(`select count(*) from public.esign_audit_events where signature_request_id = '${requestId}'`))
      .toBe('8')
  })
})
