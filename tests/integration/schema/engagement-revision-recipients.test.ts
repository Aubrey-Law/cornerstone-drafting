import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * create_engagement_agreement_revision decides who signs.
 *
 * It used to update the primary and spouse recipient rows in place, so an
 * agreement switched between individual and couple in the workspace kept the
 * signers it was drafted with: a new couple sent with one signer, and a former
 * couple still sent to the spouse. Only the real function can show which rows a
 * revision leaves behind, so this runs against the migrated schema.
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

const primary = { name: 'Alex Client', email: 'alex@example.com' }
const spouse = { name: 'Sam Client', email: 'sam@example.com' }

// Each revision needs its own render hash: (agreement_id, render_sha256) is unique.
function revise(snapshot: { primary: typeof primary; spouse: typeof spouse | null }) {
  const json = JSON.stringify(snapshot).replace(/'/g, "''")
  sql(`select id from public.create_engagement_agreement_revision(
    '${agreementId}', '${json}'::jsonb, '{}'::jsonb, '${randomUUID()}', '0')`)
}

function recipients(): string[] {
  return sql(
    `select recipient_order || ':' || role || ':' || email from public.engagement_agreement_recipients
     where agreement_id = '${agreementId}' order by recipient_order`,
  ).split('\n').filter(Boolean)
}

beforeAll(() => {
  sql(`insert into public.client_intake(id) values ('${intakeId}')`)
  sql(`insert into public.matters(id, client_intake_id) values ('${matterId}', '${intakeId}')`)
  sql(`insert into public.engagement_agreements(id, matter_id) values ('${agreementId}', '${matterId}')`)
  sql(`insert into public.engagement_agreement_recipients(agreement_id, recipient_order, role, name, email)
       values ('${agreementId}', 1, 'primary', '${primary.name}', '${primary.email}')`)
})

afterAll(() => {
  sql(`delete from public.matters where id = '${matterId}'`)
  sql(`delete from public.client_intake where id = '${intakeId}'`)
})

describe('create_engagement_agreement_revision recipients', () => {
  it('adds the spouse signer when an individual draft becomes a couple', () => {
    revise({ primary, spouse })
    expect(recipients()).toEqual(['1:primary:alex@example.com', '2:spouse:sam@example.com'])
  })

  it('swaps the two signers\' emails without tripping the unique email constraint', () => {
    revise({ primary: { ...primary, email: spouse.email }, spouse: { ...spouse, email: primary.email } })
    expect(recipients()).toEqual(['1:primary:sam@example.com', '2:spouse:alex@example.com'])
  })

  it('removes the spouse signer when a couple draft becomes an individual', () => {
    revise({ primary, spouse: null })
    expect(recipients()).toEqual(['1:primary:alex@example.com'])
  })
})
