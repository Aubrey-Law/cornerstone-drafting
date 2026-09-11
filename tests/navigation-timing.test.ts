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
})
