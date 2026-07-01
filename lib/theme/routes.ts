export const ADMIN_ROUTE_PREFIXES = ['/admin', '/va'] as const

export function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
