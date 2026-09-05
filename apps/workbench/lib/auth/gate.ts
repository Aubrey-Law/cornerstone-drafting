/**
 * Who may see what, as a pure function.
 *
 * Every access-control rule in this app is decided here, from the path and the
 * caller's role alone — no request object, no Supabase client, no cookies. That
 * is deliberate: the rules are the part worth reviewing line by line, and a
 * pure function can be enumerated as a table in a test
 * (tests/auth-gate.test.ts) instead of asserted through a mock.
 *
 * The proxy resolves the session, calls this, and translates the answer
 * (lib/auth/respond.ts).
 */

export const STAFF_ROLES = ['attorney', 'admin'] as const
export const CLIENT_ROLE = 'client'

/** The attorney's home. This app has no public surface, so it is gated too. */
export const STAFF_HOME = '/'
export const CLIENT_HOME = '/portal'

export const LOGIN_PATH = '/auth/login'

/** Served without a session. `/auth/*` includes login, sign-out and callbacks. */
const PUBLIC_PREFIXES = ['/auth', '/api/health']

const STAFF_EXACT = [STAFF_HOME]
const STAFF_PREFIXES = ['/execution', '/funding', '/matters', '/review', '/tasks', '/library', '/settings', '/api/staff']
const CLIENT_PREFIXES = [CLIENT_HOME, '/api/portal']

/**
 * Every path family that requires a session, for the proxy matcher to cover.
 *
 * Next needs `config.matcher` to be a statically analysable literal, so it
 * cannot be computed from this list — tests/proxy.test.ts cross-checks the two
 * instead. A gated path missing from the matcher is a path the proxy never
 * sees, and so a path with no access control at all.
 */
export const GATED_PATH_PATTERNS = [
  ...STAFF_EXACT,
  ...STAFF_PREFIXES,
  ...CLIENT_PREFIXES,
] as const

export type PathAudience = 'public' | 'staff' | 'client' | 'unknown'

export type Decision =
  | { kind: 'pass' }
  | { kind: 'deny'; status: 401 | 403 }
  | { kind: 'redirect'; to: string }

export type GateInput = {
  pathname: string
  redirectTo?: string | null
  userId: string | null
  role: string | null
}

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role)
}

export function isClientRole(role: string | null | undefined): boolean {
  return role === CLIENT_ROLE
}

/** Where a role belongs when no specific destination was asked for. */
export function homeForRole(role: string | null | undefined): string | null {
  if (isStaffRole(role)) return STAFF_HOME
  if (isClientRole(role)) return CLIENT_HOME
  return null
}

export function classifyPath(pathname: string): PathAudience {
  if (PUBLIC_PREFIXES.some((p) => matches(pathname, p))) return 'public'
  if (STAFF_EXACT.includes(pathname)) return 'staff'
  if (STAFF_PREFIXES.some((p) => matches(pathname, p))) return 'staff'
  if (CLIENT_PREFIXES.some((p) => matches(pathname, p))) return 'client'
  return 'unknown'
}

function isApi(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Sanitize a `redirectTo` and confirm the role is allowed to reach it.
 *
 * Rejects anything that could leave this origin, and anything belonging to the
 * other audience — sending a signed-in attorney to a portal path would only
 * bounce them back, and honouring a cross-audience target is how a redirect
 * parameter becomes a way to probe the other surface.
 */
export function sanitizeSameOriginPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/')) return null
  // `//host` is protocol-relative and leaves the origin. Some browsers
  // normalise a backslash to a forward slash, so `/\host` does too.
  if (value.startsWith('//') || value.startsWith('/\\')) return null

  try {
    const parsed = new URL(value, 'http://workbench.invalid')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

export function safeRedirectForRole(
  value: string | null | undefined,
  role: string | null | undefined,
): string | null {
  const path = sanitizeSameOriginPath(value)
  if (!path) return null

  const pathname = path.split(/[?#]/, 1)[0]
  // An API route is never a navigation destination.
  if (isApi(pathname)) return null

  const audience = classifyPath(pathname)
  if (audience === 'staff' && isStaffRole(role)) return path
  if (audience === 'client' && isClientRole(role)) return path
  return null
}

export function decide({ pathname, redirectTo, userId, role }: GateInput): Decision {
  if (pathname === LOGIN_PATH) {
    // No session: show the form.
    if (!userId) return { kind: 'pass' }
    const home = homeForRole(role)
    // A signed-in session with no role has nowhere to go. Redirecting anywhere
    // lands on a gated path, which denies back to here, which redirects again.
    // Render the page so it can say what is wrong.
    if (!home) return { kind: 'pass' }
    return { kind: 'redirect', to: safeRedirectForRole(redirectTo, role) ?? home }
  }

  const audience = classifyPath(pathname)
  if (audience === 'public') return { kind: 'pass' }
  // Let Next answer 404 for a path this app does not serve. Bouncing it to
  // login would tell an anonymous caller which paths exist.
  if (audience === 'unknown') return { kind: 'pass' }

  if (!userId) return { kind: 'deny', status: 401 }

  const belongs = audience === 'staff' ? isStaffRole(role) : isClientRole(role)
  if (belongs) return { kind: 'pass' }

  // Authenticated, wrong audience. An API caller cannot act on a redirect, and
  // re-authenticating would not help, so it is a flat 403.
  if (isApi(pathname)) return { kind: 'deny', status: 403 }

  const home = homeForRole(role)
  if (home) return { kind: 'redirect', to: home }
  return { kind: 'deny', status: 401 }
}
