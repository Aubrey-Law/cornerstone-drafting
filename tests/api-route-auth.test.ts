import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const API_ROOT = path.join(process.cwd(), 'app/api')

/**
 * Routes intentionally reachable without a logged-in firm user. Each entry
 * documents why anonymous access is safe — a new route only belongs here with
 * the same kind of justification.
 */
const PUBLIC_ROUTE_SUFFIXES = [
  // Deployment probe; reports configuration status only.
  'health/route.ts',
  // Client account creation: gated on a hashed, expiring intake invite token
  // and the account email must match the invited email.
  'intake/signup/route.ts',
  // Address-autocomplete proxy used by anonymous intake clients: same-origin
  // guard + per-IP rate limit protect the Google Places quota.
  'places/route.ts',
] as const

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

      // Pure re-export aliases inherit the auth of the route they re-export
      // (e.g. /api/microsoft/callback → /api/admin/microsoft/callback).
      if (/export \{ \w+ \} from '.*\/route'/.test(source)) {
        return
      }

      if (routePath.includes('/admin/')) {
        expect(
          hasAny(source, [
            /requireAdmin\b/,
            /requireAdminRoute\b/,
            /requireEngagementStaff\b/,
            /ENABLE_DEBUG_ROUTES/,
            /isAdmin\b/,
            /\['attorney', 'admin'\]/,
            /\['admin', 'attorney'\]/,
          ]),
        ).toBe(true)
        return
      }

      expect(
        hasAny(source, [
          /requireAdmin\b/,
          /getUser\b/,
          /Unauthorized/,
          // Webhooks: cryptographic signature verification instead of a session.
          /verifyTwilioRequest\b/,
          /verifyRetellSignature\b/,
          /verifyCalcomSignature\b/,
          /verifyEsignWebhookSecret\b/,
          // Intake uploads: invite-token or bearer auth resolved in a shared helper.
          /resolveIntakeUploadAccess\b/,
        ]),
      ).toBe(true)
    })
  }
})
