import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
})
