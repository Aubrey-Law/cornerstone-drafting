/** The attorney's Today page. */
export const DEFAULT_ADMIN_HOME = '/admin'

const ADMIN_REDIRECT_PREFIXES = ['/admin']

/**
 * Exact same-origin paths a signed-in staff user may be returned to that are
 * not under /admin.
 *
 * Empty today. It held `/auth/addin`, the Word add-in's old sign-in dialog,
 * which sent the attorney through this login page and back. That dialog is now
 * served by the add-in itself and authenticates against Supabase directly, so
 * nothing outside /admin needs the round trip any more.
 */
const ADMIN_REDIRECT_EXACT: string[] = []

const CLIENT_REDIRECT_ALLOWLIST = [
  '/dashboard',
  '/documents',
  '/messages',
  '/intake',
]

function sanitizePath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null

  try {
    const parsed = new URL(value, 'http://local.test')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

/** Allow same-origin admin paths only (blocks open redirects). */
export function safeAdminRedirectPath(value: string | null | undefined): string | null {
  const path = sanitizePath(value)
  if (!path) return null

  const pathname = path.split(/[?#]/, 1)[0]
  const allowed =
    ADMIN_REDIRECT_EXACT.includes(pathname) ||
    ADMIN_REDIRECT_PREFIXES.some(
      prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  return allowed ? path : null
}

/** Allow same-origin client portal paths only (blocks open redirects). */
export function safeClientRedirectPath(value: string | null | undefined): string | null {
  const path = sanitizePath(value)
  if (!path) return null

  const pathname = path.split(/[?#]/, 1)[0]
  const allowed = CLIENT_REDIRECT_ALLOWLIST.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  return allowed ? path : null
}

/** Role-aware redirect sanitizer for login/callback. */
export function safeRedirectPathForRole(
  value: string | null | undefined,
  role: string | null | undefined,
): string | null {
  if (role === 'attorney' || role === 'admin') return safeAdminRedirectPath(value)
  if (role === 'client') return safeClientRedirectPath(value)
  return null
}
