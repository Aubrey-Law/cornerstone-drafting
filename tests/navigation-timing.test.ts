import { describe, expect, it, vi, afterEach } from 'vitest'
import { firmRoute, startNavigation, primaryContentReady } from '@/lib/performance/navigationTiming'
afterEach(() => vi.restoreAllMocks())
describe('local navigation timing', () => {
  it('keeps only allowlisted labels and records readiness only for the clicked destination', () => {
    const measure = vi.spyOn(performance, 'measure')
    const route = firmRoute('/admin/matters/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')!
    startNavigation(route)
    primaryContentReady('Tasks')
    expect(measure).not.toHaveBeenCalled()
    primaryContentReady('Matter detail')
    expect(measure).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(measure.mock.calls)).not.toContain('aaaaaaaa')
    primaryContentReady('Matter detail')
    expect(measure).toHaveBeenCalledTimes(1)
    expect(firmRoute('/admin/settings')).toBeNull()
    expect(firmRoute('/admin/crm/opportunities')).toBe('Leads')
    expect(firmRoute('/admin/leads')).toBe('Leads')
  })

  it('separates response wait, transfer, and browser render without retaining URLs', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_700)
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{
      initiatorType: 'fetch',
      startTime: 1_100,
      responseStart: 2_000,
      responseEnd: 2_200,
      name: 'https://cornerstone.example/admin/billing?client=private',
      serverTiming: [
        { name: 'proxy', duration: 125 },
        { name: 'auth', duration: 80 },
        { name: 'ignored-private-stage', duration: 999 },
      ],
    } as unknown as PerformanceResourceTiming])
    const measure = vi.spyOn(performance, 'measure')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})

    startNavigation('Billing')
    primaryContentReady('Billing')

    const detail = (measure.mock.calls[0][1] as PerformanceMeasureOptions).detail
    expect(detail).toEqual({
      route: 'Billing', phase: 'content-ready', totalMs: 1700,
      responseWaitMs: 1000, responseTransferMs: 200, renderMs: 500,
      proxyMs: 125, proxyAuthMs: 80,
    })
    expect(log).toHaveBeenCalledWith('[navigation-timing]', detail)
    expect(JSON.stringify({ detail, log: log.mock.calls })).not.toMatch(/private|cornerstone\.example|ignored/)
  })
})
