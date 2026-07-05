const ADMIN_REDIRECT_PREFIXES = ['/admin']

/** Allow same-origin admin paths only (blocks open redirects). */
export function safeAdminRedirectPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null

  let path: string
  try {
    const parsed = new URL(value, 'http://local.test')
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }

  const pathname = path.split(/[?#]/, 1)[0]
  const allowed = ADMIN_REDIRECT_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  return allowed ? path : null
}
