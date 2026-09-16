import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativeEsignProvider } from '@/lib/esign/native'

/**
 * The native provider against the real migrated schema.
 *
 * It shipped writing `agreement_id: crypto.randomUUID()` into a column declared
 * `references engagement_agreements(id)`. That insert could not succeed on any
 * input, so the engine was incapable of creating a signing session from the day
 * it was written — and 5,704 unit tests passed over it, because those tests mock
 * getAdminClient() and a mock enforces no foreign keys.
 *
 * Nor could the integration suite have caught it. The five files in the parent
 * directory run against tests/integration/fixtures/firm-remediation.sql, a
 * deliberately minimal synthetic catalog with two foreign keys in total and no
 * e-sign tables at all. Only the real migrations carry the constraint that makes
 * this defect impossible, which is why this file lives here and runs against
 * them. See tests/integration/fixtures/README.md.
 *
 * Everything external stays stubbed — R2, and the anchor lookup, which wants a
 * LibreOffice-rendered PDF. The database stays real, because the database is the
 * only part that could have caught it.
 */

vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))
vi.mock('@/lib/esign/nativeAnchors', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/esign/nativeAnchors')>()),
  locateAnchors: vi.fn(async () => []),
}))

const target = new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if (!['postgres:', 'postgresql:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('Explicit local Postgres fixture required')
}

function sql(query: string): string {
  // -q as well as -t: without it psql appends the command tag to the tuples of
  // an INSERT ... RETURNING, so a returned id arrives as "<uuid>\nINSERT 0 1".
  // This test no longer reads ids back, but the next one might.
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

const provider = createNativeEsignProvider()
const recipients = [
  { key: 'primary', name: 'Walter White', email: 'primary@example.com', order: 1 },
  { key: 'spouse', name: 'Skylar White', email: 'spouse@example.com', order: 2 },
]

function request(agreementId: string) {
  return provider.createDocumentRequest({
    agreementId,
    name: 'Engagement Agreement — integration',
    document: Buffer.from('%PDF-1.7'),
    recipients,
    anchors: [],
    expirationHours: 168,
    customMessage: '',
  })
}

// Minted here rather than read back from `returning`, which is how every other
// integration test in this repo seeds (md5(prefix||n)::uuid). Both columns are
// `uuid primary key default gen_random_uuid()`, so supplying one is free.
const leadId = randomUUID()
const agreementId = randomUUID()

beforeAll(() => {
  // engagement_agreements requires exactly one of matter_id / lead_id, both
  // foreign keys. A lead is the cheaper parent: client_intake needs no column
  // set. lead_id and esign_signing_sessions.agreement_id both cascade on
  // delete, so removing the lead in afterAll removes everything below it.
  sql(`insert into public.client_intake(id) values ('${leadId}')`)
  sql(`insert into public.engagement_agreements(id, lead_id) values ('${agreementId}', '${leadId}')`)
})

afterAll(() => {
  sql(`delete from public.client_intake where id = '${leadId}'`)
})

beforeEach(() => {
  // The integration setup replaces the environment wholesale and does not carry
  // an app origin, which signingUrl requires before it will build a link.
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  sql(`delete from public.esign_signing_sessions where agreement_id = '${agreementId}'`)
})

describe('createDocumentRequest against the real migrated schema', () => {
  it('writes a session for every recipient, keyed to the agreement itself', async () => {
    const result = await request(agreementId)

    // The request id *is* the agreement: this provider has no external system
    // to mint one, and app/api/sign/[token]/route.ts reads the agreement back
    // by it and rebuilds the document's R2 key from it.
    expect(result.requestId).toBe(agreementId)
    expect(result.recipients).toHaveLength(2)

    const rows = sql(
      `select recipient_key from public.esign_signing_sessions
       where agreement_id = '${agreementId}' order by recipient_key`,
    ).split('\n').filter(Boolean)
    expect(rows).toEqual(['primary', 'spouse'])
  })

  it('refuses an agreement that does not exist', async () => {
    // The shipped defect, reproduced. A fresh UUID satisfies every type and
    // every mock, and no real schema will accept it. This case and the one
    // above are the same code path over a real parent and an invented one —
    // the difference between them is what #494 was.
    const orphan = randomUUID()

    await expect(request(orphan)).rejects.toThrow(/foreign key|violates/i)

    expect(sql(`select count(*) from public.esign_signing_sessions where agreement_id = '${orphan}'`))
      .toBe('0')
  })

  it('stores only the hash of a signing token', async () => {
    const result = await request(agreementId)
    const link = result.recipients[0].signingLink ?? ''
    const token = link.slice(link.lastIndexOf('/') + 1)

    expect(token).not.toBe('')

    // The raw token is the only credential on the public signing route. It
    // leaves in the email and is never written down.
    const stored = sql(
      `select row_to_json(s)::text from public.esign_signing_sessions s
       where agreement_id = '${agreementId}' limit 1`,
    )
    expect(stored).not.toContain(token)
    expect(stored).toMatch(/"token_hash":"[0-9a-f]{64}"/)
  })
})
