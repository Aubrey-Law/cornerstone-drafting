import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mattersClientConfig } from '../tools/matters-mcp/src/client'

const root = join(__dirname, '..')
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'))

/**
 * The wiring nothing else catches.
 *
 * Three separate lists in this repository have to name a new tool directory
 * before it is built, linted, or verified, and none of them uses a glob. A
 * missing entry fails silently: the package is not installed, the code is not
 * linted, or — worst — the RPC it calls is never cross-checked against the
 * database, which is the one failure `checkDbRpcs.mjs` exists to prevent.
 */
describe('matters-mcp is wired into the repository', () => {
  it('is an npm workspace, since the list is explicit and not a glob', () => {
    expect(readJson('package.json').workspaces).toContain('tools/matters-mcp')
  })

  it('has its RPC calls cross-checked against the database', () => {
    const checker = readFileSync(join(root, 'scripts/checkDbRpcs.mjs'), 'utf8')
    const dirs = checker.match(/const SOURCE_DIRS = \[([\s\S]*?)\]/)?.[1] ?? ''
    expect(dirs).toContain('tools/matters-mcp/src')
  })

  it('declares the dependencies its source imports', () => {
    const pkg = readJson('tools/matters-mcp/package.json')
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const dep of ['@modelcontextprotocol/sdk', '@supabase/supabase-js', '@aubrey-law/db-types', 'zod']) {
      expect(Object.keys(deps)).toContain(dep)
    }
  })

  it('is linted, since the lint script names its directories', () => {
    expect(readJson('package.json').scripts.lint).toContain('tools/matters-mcp/src')
  })
})

/**
 * Configuration is read as a pure function of an environment object, so the
 * refusal can be tested without mutating `process.env` and without a network
 * call. A server that starts with a missing key and fails on the first tool
 * call reports the problem far from its cause.
 */
describe('mattersClientConfig', () => {
  it('reads the url and service key', () => {
    expect(
      mattersClientConfig({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      }),
    ).toEqual({ url: 'https://example.supabase.co', serviceKey: 'service-key' })
  })

  it('accepts NEXT_PUBLIC_SUPABASE_URL, which is what .env.local actually sets', () => {
    expect(
      mattersClientConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      }).url,
    ).toBe('https://example.supabase.co')
  })

  it('names the variable that is missing rather than failing later', () => {
    expect(() => mattersClientConfig({ SUPABASE_URL: 'https://example.supabase.co' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
    expect(() => mattersClientConfig({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(/SUPABASE_URL/)
  })

  it('treats an empty string as missing, because a blank env var is the common case', () => {
    expect(() =>
      mattersClientConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
