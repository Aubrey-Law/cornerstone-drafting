import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/lawmatics/client', () => ({ lawmaticsRequest: mocks.request }))
import { listAllLawmaticsOptions, listLawmaticsOptions } from '@/lib/integrations/lawmatics/options'

beforeEach(() => vi.clearAllMocks())

describe('Lawmatics picklist options', () => {
  it('reads JSON:API rows, sorted by name, skipping rows without a numeric ID', async () => {
    mocks.request.mockResolvedValueOnce([
      { id: '14', type: 'practice_area', attributes: { name: 'Probate' } },
      { id: 11, type: 'practice_area', attributes: { name: 'Estate Planning' } },
      { id: 'x', attributes: { name: 'Broken' } },
      { id: '15', attributes: {} },
    ])

    await expect(listLawmaticsOptions('practice_area')).resolves.toEqual([
      { id: '15', name: '#15' },
      { id: '11', name: 'Estate Planning' },
      { id: '14', name: 'Probate' },
    ])
    expect(mocks.request).toHaveBeenCalledWith('/v1/practice_areas?page=1&per_page=100', { method: 'GET' })
  })

  it('reads every page until a short one', async () => {
    const page = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: String(start + i), attributes: { name: `S${start + i}` } }))
    mocks.request.mockResolvedValueOnce(page(1, 100)).mockResolvedValueOnce(page(101, 3))

    await expect(listLawmaticsOptions('source')).resolves.toHaveLength(103)
    expect(mocks.request).toHaveBeenLastCalledWith('/v1/sources?page=2&per_page=100', { method: 'GET' })
  })

  it('loads each list independently so one failure leaves the others usable', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/campaigns')) {
        throw new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'not_found',
          safeMessage: 'The Lawmatics record could not be found.', retryAfterMs: null })
      }
      return [{ id: '1', attributes: { name: 'One' } }]
    })

    await expect(listAllLawmaticsOptions()).resolves.toEqual({
      practice_area: { ok: true, options: [{ id: '1', name: 'One' }] },
      source: { ok: true, options: [{ id: '1', name: 'One' }] },
      campaign: { ok: false, error: 'The Lawmatics record could not be found.' },
    })
  })
})
