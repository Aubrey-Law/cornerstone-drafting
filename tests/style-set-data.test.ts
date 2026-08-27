import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The resolver's contract is that formatting configuration can never be the
 * reason a document fails to generate. These exercise every way the read can go
 * wrong and assert the same outcome each time: a usable style set comes back.
 */

const from = vi.fn()
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from }) }))

// Static import, since vi.mock is hoisted above it.
import { resolveStyleSet } from '@/lib/styleSets/data'
import { DEFAULT_STYLE_SET } from '@/lib/styleSets/defaults'
import { PRESERVE } from '@/lib/styleSets/schema'

/** A stubbed PostgREST chain that resolves to `result` whenever it is awaited. */
function chain(result: { data: unknown; error: unknown }) {
  const thenable: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  for (const method of ['select', 'eq', 'is', 'order', 'maybeSingle', 'single', 'neq', 'update']) {
    thenable[method] = () => thenable
  }
  return thenable
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ss-1',
    name: 'House style',
    description: null,
    settings: { body: { fontFamily: 'Garamond' }, title: { fontSizePt: 14 } },
    is_default: true,
    source_file_name: null,
    source_r2_key: null,
    source_size_bytes: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('resolveStyleSet', () => {
  beforeEach(() => {
    from.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns the stored default when one exists', async () => {
    from.mockReturnValue(chain({ data: row(), error: null }))
    const settings = await resolveStyleSet()
    expect(settings.title.fontSizePt).toBe(14)
    expect(settings.body.fontFamily).toBe('Garamond')
  })

  it('fills unstated fields with preserve rather than with defaults', async () => {
    from.mockReturnValue(chain({ data: row(), error: null }))
    const settings = await resolveStyleSet()
    expect(settings.page.margins.leftPt).toBe(PRESERVE)
  })

  it('falls back to the built-in when no style set is marked default', async () => {
    from.mockReturnValue(chain({ data: null, error: null }))
    expect(await resolveStyleSet()).toEqual(DEFAULT_STYLE_SET)
  })

  it('falls back rather than throwing when the read errors', async () => {
    // A draft in last month's formatting is a nuisance; a draft that does not
    // exist because a settings row could not be read is an outage.
    from.mockReturnValue(chain({ data: null, error: { message: 'connection refused' } }))
    expect(await resolveStyleSet()).toEqual(DEFAULT_STYLE_SET)
  })

  it('falls back when the stored settings are malformed', async () => {
    from.mockReturnValue(chain({ data: row({ settings: { body: { fontSizePt: -4 } } }), error: null }))
    expect(await resolveStyleSet()).toEqual(DEFAULT_STYLE_SET)
  })

  it('prefers an explicitly named style set over the default', async () => {
    from.mockReturnValueOnce(
      chain({ data: row({ id: 'ss-2', is_default: false, settings: { body: { fontSizePt: 12 } } }), error: null }),
    )
    const settings = await resolveStyleSet('ss-2')
    expect(settings.body.fontSizePt).toBe(12)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default row when the named style set is gone', async () => {
    // A style set deleted after a matter was drafted must not break a redraft.
    from.mockReturnValueOnce(chain({ data: null, error: null }))
    from.mockReturnValueOnce(chain({ data: row(), error: null }))
    const settings = await resolveStyleSet('deleted-id')
    expect(settings.title.fontSizePt).toBe(14)
  })
})
