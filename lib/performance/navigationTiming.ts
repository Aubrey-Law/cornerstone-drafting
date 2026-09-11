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
  const ended = performance.now()
  const totalMs = Math.round(ended - started)
  const detail: Record<string, string | number> = {
    route,
    phase: 'content-ready',
    totalMs,
  }
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  let navigationResource: PerformanceResourceTiming | undefined
  for (const entry of resources) {
    if (entry.initiatorType === 'fetch' && entry.startTime >= started
      && (!navigationResource || entry.startTime < navigationResource.startTime)) {
      navigationResource = entry
    }
  }
  if (navigationResource && navigationResource.responseEnd > 0) {
    detail.responseWaitMs = Math.max(0, Math.round(navigationResource.responseStart - started))
    detail.responseTransferMs = Math.max(0, Math.round(navigationResource.responseEnd - navigationResource.responseStart))
    detail.renderMs = Math.max(0, Math.round(ended - navigationResource.responseEnd))
    const allowedServerTimings: Record<string, string> = {
      proxy: 'proxyMs', auth: 'proxyAuthMs', role: 'proxyRoleMs',
    }
    for (const timing of navigationResource.serverTiming ?? []) {
      const key = allowedServerTimings[timing.name]
      if (key) detail[key] = Math.round(timing.duration)
    }
  }
  // Bound local history; DevTools can capture entries during an explicit trace.
  if (performance.getEntriesByName(name).length >= 100) performance.clearMeasures(name)
  performance.measure(name, { start: started, end: ended, detail })
  if (totalMs >= 1500) {
    try { console.info('[navigation-timing]', detail) } catch { /* diagnostics are best effort */ }
  }
}
