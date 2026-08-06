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
  // Public firm-wide onboarding: Cloudflare Turnstile, per-IP + per-email rate
  // limits, duplicate-safe responses, and server-only Auth/lead creation.
  'intake/register/route.ts',
  // Address-autocomplete proxy used by anonymous intake clients: same-origin
  // guard + per-IP rate limit protect the Google Places quota.
  'places/route.ts',
  // Public scheduling: anonymous prospects book from /book/[slug]. Per-IP
  // rate limited; anonymous callers only see public appointment types and
  // free slot times (never busy-event details); portal-only types require a
  // session (or, for availability, a valid hashed manage token).
  'scheduling/types/route.ts',
  'scheduling/availability/route.ts',
  'scheduling/book/route.ts',
  // Manage link: authorization is possession of an unguessable 256-bit token
  // stored hashed with an expiry (same pattern as intake invite tokens).
  'scheduling/manage/[token]/route.ts',
  // Telnyx fetches this fixed-destination TeXML instruction document when an
  // inbound call arrives; it accepts no caller-controlled input or user data.
  'voice/telnyx/inbound/route.ts',
  // One-click unsubscribe from a marketing email. Authorization is possession
  // of an unguessable 256-bit token (same pattern as scheduling/manage), which
  // is format-checked then looked up; an unknown token 404s. Requiring a
  // session here would break CAN-SPAM one-click unsubscribe.
  'unsubscribe/[token]/route.ts',
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
            /requireAdministrator\b/,
            /requireAdminRoute\b/,
            /requireEngagementStaff\b/,
            /ENABLE_DEBUG_ROUTES/,
            /isAdmin\b/,
            // Document routes: getDocumentApiUser + isAdminUser (lib/documentSecurity).
            /isAdminUser\b/,
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
          /unwrapTelnyxWebhook\b/,
          /verifyTelnyxWebhookRequest\b/,
          /verifyRetellSignature\b/,
          /verifyCalcomSignature\b/,
          /verifyCalendlySignature\b/,
          /verifyFirmaWebhookSignature\b/,
          // Mailgun signs webhooks with an HMAC over timestamp+token rather
          // than a header, so the check is a local helper: HMAC-SHA256 with
          // timingSafeEqual and a 15-minute replay window, 401 on failure.
          /hasValidSignature\b/,
          // Intake uploads: invite-token or bearer auth resolved in a shared helper.
          /resolveIntakeUploadAccess\b/,
        ]),
      ).toBe(true)
    })
  }
})
