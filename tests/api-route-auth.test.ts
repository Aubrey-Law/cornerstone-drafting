import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const API_ROOT = path.join(process.cwd(), 'app/api')

/** Routes intentionally reachable without a logged-in firm user. */
const PUBLIC_ROUTE_SUFFIXES = ['health/route.ts'] as const

function listRouteFiles(dir = API_ROOT, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, acc)
    else if (entry.name === 'route.ts') acc.push(full)
  }
  return acc.sort()
}

function rel(p: string) {
  return path.relative(process.cwd(), p).replace(/\\/g, '/')
}

function hasAny(source: string, patterns: RegExp[]) {
  return patterns.some(p => p.test(source))
}

describe('API route auth coverage', () => {
  const routes = listRouteFiles()

  it('discovers route handlers', () => {
    expect(routes.length).toBeGreaterThan(5)
  })

  for (const file of routes) {
    const routePath = rel(file)

    it(`${routePath} meets auth expectations`, () => {
      const source = fs.readFileSync(file, 'utf8')

      if (PUBLIC_ROUTE_SUFFIXES.some(s => routePath.endsWith(s))) {
        return
      }

      if (routePath.includes('/admin/')) {
        expect(
          hasAny(source, [
            /requireAdmin\b/,
            /requireAdminFast\b/,
            /requireAdminRoute\b/,
            /ENABLE_DEBUG_ROUTES/,
            /isAdmin\b/,
            /\['attorney', 'admin'\]/,
          ]),
        ).toBe(true)
        return
      }

      expect(
        hasAny(source, [
          /requireAdmin\b/,
          /getUser\b/,
          /Unauthorized/,
        ]),
      ).toBe(true)
    })
  }
})
