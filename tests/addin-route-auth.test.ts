import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ADDIN_API_ROOT = path.join(process.cwd(), 'app/api/addin')

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, acc)
    else if (entry.name === 'route.ts') acc.push(full)
  }
  return acc.sort()
}

/**
 * `/api/addin/*` sits deliberately outside `proxy.ts`'s matcher, because that
 * middleware resolves the session from cookies only and would reject the Word
 * add-in's bearer token before any handler ran.
 *
 * The cost of that choice is that these routes have NO middleware backstop.
 * Every one of them must gate itself.
 */
describe('add-in API routes', () => {
  const routes = listRouteFiles(ADDIN_API_ROOT)

  it('exist', () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  it('are not covered by the proxy middleware matcher', () => {
    const proxy = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')
    const matcher = proxy.slice(proxy.indexOf('matcher:'))
    expect(matcher).not.toContain('/api/addin')
  })

  for (const file of routes) {
    const routePath = path.relative(process.cwd(), file).replace(/\\/g, '/')

    it(`${routePath} gates itself with requireAdmin`, () => {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).toContain('requireAdmin(req)')
      // The gate has to run before any work, and its error has to be returned.
      expect(source).toMatch(/if \(auth\.err\) return auth\.err/)
    })
  }
})
