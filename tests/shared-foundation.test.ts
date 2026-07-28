import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, ApiRequestError } from '@/lib/clientApi'
import { compareNullable, normalizeSearchText, stableSort, timestamp } from '@/lib/collections'
import {
  formatCompactCurrency,
  formatCurrency,
  formatFileSize,
  formatFirmDate,
  formatFirmDateTime,
} from '@/lib/format'

afterEach(() => {
  vi.unstubAllGlobals()
})
describe('shared collection helpers', () => {
  it('normalizes search text and keeps null values last', () => {
    expect(normalizeSearchText('  Aubrey LAW ')).toBe('aubrey law')
    expect(compareNullable(null, 2, (a, b) => a - b)).toBe(1)
    expect(compareNullable(2, null, (a, b) => a - b)).toBe(-1)
  })

  it('sorts stably when the comparator considers values equal', () => {
    const values = [
      { id: 'first', group: 1 },
      { id: 'second', group: 1 },
      { id: 'third', group: 0 },
    ]
    expect(stableSort(values, (a, b) => a.group - b.group).map(value => value.id))
      .toEqual(['third', 'first', 'second'])
  })

  it('returns null for invalid timestamps', () => {
    expect(timestamp('not-a-date')).toBeNull()
    expect(timestamp(null)).toBeNull()
  })
})

describe('shared formatters', () => {
  it('formats firm dates in Eastern time', () => {
    expect(formatFirmDate('2026-07-29T01:00:00Z')).toBe('Jul 28, 2026')
    expect(formatFirmDateTime('2026-07-29T01:00:00Z')).toContain('Jul 28, 2026')
  })

  it('formats money and file sizes consistently', () => {
    expect(formatCurrency(1250.5)).toBe('$1,250.50')
    expect(formatCompactCurrency(1250.5)).toBe('$1,251')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(-1)).toBe('')
  })
})

describe('client API requests', () => {
  it('returns parsed JSON for successful requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    await expect(apiRequest<{ ok: boolean }>('/api/example')).resolves.toEqual({ ok: true })
  })

  it('throws a typed error using the API error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'No access' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    const request = apiRequest('/api/example')
    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'No access',
      status: 403,
    } satisfies Partial<ApiRequestError>)
  })
})
