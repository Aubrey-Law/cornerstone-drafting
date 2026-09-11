/** Local User Timing entries only: no URLs, record IDs, query strings, or network sends. */
export const FIRM_ROUTES = ['Today', 'Leads', 'Lead detail', 'Matters', 'Matter detail', 'Tasks', 'Billing'] as const
export type FirmRoute = typeof FIRM_ROUTES[number]
export function firmRoute(pathname: string): FirmRoute | null {
  if (pathname === '/admin') return 'Today'
  if (pathname === '/admin/leads' || pathname === '/admin/crm/opportunities') return 'Leads'
  if (/^\/admin\/(?:leads|crm\/opportunities)\/[^/]+$/.test(pathname)) return 'Lead detail'
  if (pathname === '/admin/matters/list') return 'Matters'
  if (/^\/admin\/matters\/[0-9a-f-]{36}$/i.test(pathname)) return 'Matter detail'
  if (pathname === '/admin/tasks') return 'Tasks'
  if (pathname === '/admin/billing' || pathname === '/admin/billing/invoices') return 'Billing'
  return null
}
let pending: { route: FirmRoute; started: number } | null = null
export function startNavigation(route: FirmRoute) {
  pending = { route, started: performance.now() }
  performance.clearMarks('firm-navigation:start')
  performance.mark('firm-navigation:start', { detail: { route } })
}
export function primaryContentReady(route: FirmRoute) {
  if (pending?.route !== route) return
  const started = pending.started
  pending = null
  const name = `firm-navigation:${route}`
  // Bound local history; DevTools can capture entries during an explicit trace.
  if (performance.getEntriesByName(name).length >= 100) performance.clearMeasures(name)
  performance.measure(name, { start: started, end: performance.now(), detail: { route, phase: 'content-ready' } })
}
