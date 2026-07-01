const CLIENT_REDIRECT_ALLOWLIST = [
  '/dashboard',
  '/documents',
  '/messages',
  '/plan-review',
  '/design-review',
  '/calendar',
  '/intake',
]

export function safeClientRedirectPath(value: string | null | undefined): string | null {
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
  const allowed = CLIENT_REDIRECT_ALLOWLIST.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  return allowed ? path : null
}
