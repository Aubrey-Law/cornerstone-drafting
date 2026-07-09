const ADMIN_REDIRECT_PREFIXES = ['/admin']

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
  const allowed = ADMIN_REDIRECT_PREFIXES.some(
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
