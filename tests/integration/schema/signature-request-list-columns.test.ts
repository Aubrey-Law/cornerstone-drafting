import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every column the signature-request route reads, read from the real schema.
 *
 * The route's unit tests drive a fake that answers whatever it is asked, so a
 * column that does not exist — renamed, never added, spelled differently on the
 * two e-sign tables — passes every one of them and returns a 500 the first time
 * an attorney opens the documents tab.
 *
 * The queries are taken out of the route rather than written here. A list
 * copied into a test is a second thing to keep in step, and the one that drifts
 * is always the copy.
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

const ROUTE = 'app/api/admin/matters/[id]/signature-requests/route.ts'

/** Every `.from('table').select('a, b, c')` pair in the route, in order. */
function routeSelects(): Array<{ table: string; columns: string }> {
  const source = fs.readFileSync(path.join(process.cwd(), ROUTE), 'utf8')
  const pattern = /\.from\('(\w+)'\)\s*\.select\(\s*'([^']+)'\s*\)/g
  return [...source.matchAll(pattern)].map(match => ({ table: match[1], columns: match[2] }))
}

describe('the signature-request route', () => {
  const selects = routeSelects()

  it('reads from the four tables it is supposed to', () => {
    // A guard on the guard: a refactor that changes how the queries are written
    // would otherwise leave this file quietly asserting nothing at all.
    expect(selects.map(select => select.table).sort()).toEqual([
      'esign_signing_sessions',
      'matter_documents',
      'signature_request_recipients',
      'signature_requests',
    ])
  })

  it.each(selects)('selects columns that exist on $table', ({ table, columns }) => {
    // `limit 0` runs the planner over the column list without reading a row,
    // so this is the same failure Postgres would give the route.
    expect(() => sql(`select ${columns} from public.${table} limit 0`)).not.toThrow()
  })
})
