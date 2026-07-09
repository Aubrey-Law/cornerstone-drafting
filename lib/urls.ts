// Hostname helpers for the portal/firm split.
//
// Two public hosts share one Next.js deployment:
//   portal.aubreylegal.com  → client-facing (intake, dashboard, documents, …)
//   app.aubreylegal.com     → firm-facing (admin, va)
//
// `portalUrl()` builds links meant for clients (or anonymous leads).
// `appUrl()` builds links meant for firm staff.
//
// Both fall back to localhost when env is unset so local dev keeps working.

const DEFAULT_LOCAL = 'http://localhost:3000'

function trimTrailingSlash(s: string) {
  return s.replace(/\/$/, '')
}

function normalizePath(path: string): string {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

export function portalUrl(path = ''): string {
  const base = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PORTAL_URL ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      DEFAULT_LOCAL,
  )
  return `${base}${normalizePath(path)}`
}

export function appUrl(path = ''): string {
  const base = trimTrailingSlash(
    process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_LOCAL,
  )
  return `${base}${normalizePath(path)}`
}
