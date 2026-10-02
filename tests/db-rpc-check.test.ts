import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classifyMissingRpcs, migrationDefinedRpcs } from '@/scripts/checkDbRpcs.mjs'

/**
 * The RPC check has to answer two questions that look identical and are not:
 * "this function vanished from the database" and "this function is new in this
 * branch and has not deployed yet". Conflating them made the check impossible
 * to pass on any pull request that adds an RPC; splitting them wrong would give
 * back the outage it was written for.
 */

describe('migrationDefinedRpcs', () => {
  it('finds functions the repo migrations create', () => {
    const defined = migrationDefinedRpcs()
    expect(defined.has('claim_esign_webhook_event')).toBe(true)
    expect(defined.has('claim_firma_webhook_event')).toBe(true)
    expect(defined.has('ensure_user_profile')).toBe(true)
    expect(defined.has('correct_matter')).toBe(true)
    expect(defined.has('not_a_real_function')).toBe(false)
  })

  it('reads every spelling the migrations use, and ignores non-SQL files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpc-check-'))
    writeFileSync(join(dir, '1_plain.sql'), 'create function plain_one() returns void;')
    writeFileSync(join(dir, '2_replace.sql'), 'CREATE OR REPLACE FUNCTION replaced_one()')
    writeFileSync(join(dir, '3_qualified.sql'), 'create or replace function public.qualified_one(')
    writeFileSync(join(dir, '4_multi.sql'), 'create function a_one();\ncreate function b_one();')
    writeFileSync(join(dir, 'notes.md'), 'create function not_sql_one()')

    const defined = migrationDefinedRpcs(dir)

    expect([...defined].sort()).toEqual(
      ['a_one', 'b_one', 'plain_one', 'qualified_one', 'replaced_one'],
    )
    expect(defined.has('not_sql_one')).toBe(false)
  })

  it('returns an empty set for a directory that is not there', () => {
    expect(migrationDefinedRpcs('supabase/migrations-does-not-exist').size).toBe(0)
  })
})

describe('classifyMissingRpcs', () => {
  const defined = new Set(['claim_esign_webhook_event', 'update_lead_opportunity_field'])

  it('treats an RPC no migration defines as a hard failure', () => {
    // Nothing in the repo or the database defines it — the call name is wrong,
    // or the migration was never written. A bug in every context.
    expect(classifyMissingRpcs(['not_a_real_function'], defined)).toEqual({
      undefined: ['not_a_real_function'],
      pendingDeploy: [],
    })
  })

  it('treats an RPC a repo migration defines as pending deploy', () => {
    expect(classifyMissingRpcs(['claim_esign_webhook_event'], defined)).toEqual({
      undefined: [],
      pendingDeploy: ['claim_esign_webhook_event'],
    })
  })

  it('separates the two when both are missing at once', () => {
    expect(classifyMissingRpcs(['claim_esign_webhook_event', 'not_a_real_function'], defined))
      .toEqual({
        undefined: ['not_a_real_function'],
        pendingDeploy: ['claim_esign_webhook_event'],
      })
  })

  it('classifies the original outage function as pending deploy, not undefined', () => {
    // `update_lead_opportunity_field` went missing from the database while its
    // migration sat in the repo claiming to have been applied. It is
    // repo-defined, so it lands in pendingDeploy — which the end-to-end tests
    // below prove still fails on push and schedule. That is the whole safety
    // argument for this change.
    expect(classifyMissingRpcs(['update_lead_opportunity_field'], defined).pendingDeploy)
      .toEqual(['update_lead_opportunity_field'])
  })

  it('reports nothing when nothing is missing', () => {
    expect(classifyMissingRpcs([], defined)).toEqual({ undefined: [], pendingDeploy: [] })
  })
})

/**
 * End-to-end against a stub PostgREST, because the exit code is the contract CI
 * consumes — correct classification is necessary but not sufficient.
 *
 * `spawn`, never `spawnSync`: the stub server runs on this process's event
 * loop, and a synchronous child would block it so the request could never be
 * answered.
 */
describe('checkDbRpcs exit codes', () => {
  let server: Server
  let url = ''
  // Withhold exactly one RPC — one this repo's migrations do define — so the
  // run turns on the pending-deploy branch and nothing else.
  const withheld = new Set(['claim_esign_webhook_event'])

  beforeAll(async () => {
    const exposed = calledRpcNames().filter(name => !withheld.has(name))
    server = createServer((_req, res) => {
      const paths: Record<string, unknown> = {}
      for (const name of exposed) paths[`/rpc/${name}`] = {}
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ paths }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
  }, 30_000)

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  function run(eventName?: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
      const child = spawn('node', ['scripts/checkDbRpcs.mjs'], {
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: url,
          SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
          ...(eventName === undefined ? {} : { GITHUB_EVENT_NAME: eventName }),
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
    })
  }

  it('passes on a pull request when the only gap is a migration in this branch', async () => {
    const result = await run('pull_request')

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('claim_esign_webhook_event')
    expect(result.stdout).toContain('not deployed yet')
  })

  it('fails on a push to main for the same gap', async () => {
    // On main the migration should already have been applied, so this same
    // state means the SQL never ran — the outage the check exists for.
    const result = await run('push')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('claim_esign_webhook_event')
  })

  it('fails on the scheduled run', async () => {
    expect((await run('schedule')).code).toBe(1)
  })

  it('fails with no event name, as when a developer runs it by hand', async () => {
    // Someone running this locally is checking a deployed database, so the
    // permissive branch must never be the default.
    expect((await run()).code).toBe(1)
  })
})

/** The RPC names the script itself collects, read the same way it reads them. */
function calledRpcNames(): string[] {
  const dirs = [
    'app', 'lib', 'components', 'tools/matters-mcp/src',
  ]
  const skip = new Set(['node_modules', '.next', 'dist', 'build'])
  const names = new Set<string>()
  const walk = (dir: string) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (['.ts', '.tsx'].includes(extname(entry.name))) {
        const content = readFileSync(path, 'utf8')
        for (const match of content.matchAll(/\.rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) {
          names.add(match[1])
        }
      }
    }
  }
  dirs.forEach(walk)
  return [...names]
}
