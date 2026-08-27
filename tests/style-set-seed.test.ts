import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seed's whole risk is overwriting somebody's work. These pin the three
 * outcomes it distinguishes: create what is missing, recognise what it already
 * wrote, and keep its hands off what has since been edited.
 */

const insert = vi.fn()
const from = vi.fn()
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from }) }))

// Static imports, since vi.mock is hoisted above them.
import { seedStyleSets } from '@/lib/styleSets/seed'
import { AUBREY_HOUSE_STYLE_SET, LEGACY_GARAMOND_STYLE_SET } from '@/lib/styleSets/defaults'
import { PRESERVE_ALL_SETTINGS } from '@/lib/styleSets/schema'

const HOUSE = 'Aubrey Law house style'
const LEGACY = 'Garamond only'

/** A stubbed PostgREST chain: `select` resolves to rows, `insert` records calls. */
function stubDb(rows: Array<{ id: string; name: string; settings: unknown }>) {
  from.mockImplementation(() => ({
    select: () => ({
      is: () => Promise.resolve({ data: rows, error: null }),
    }),
    insert: (payload: unknown) => {
      insert(payload)
      return Promise.resolve({ error: null })
    },
  }))
}

describe('seedStyleSets', () => {
  beforeEach(() => {
    from.mockReset()
    insert.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates both built-ins when the table is empty', async () => {
    stubDb([])
    const result = await seedStyleSets()
    expect(result.created).toEqual([LEGACY, HOUSE])
    expect(result.unchanged).toEqual([])
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('never marks a seeded style set as the default', async () => {
    // Adopting a style set changes every document the firm generates. That is a
    // decision for somebody looking at the preview, not for a script.
    stubDb([])
    await seedStyleSets()
    for (const [payload] of insert.mock.calls) {
      expect((payload as { is_default: boolean }).is_default).toBe(false)
    }
  })

  it('writes the settings the constants actually hold', async () => {
    stubDb([])
    await seedStyleSets()
    const written = insert.mock.calls.map(([payload]) => payload as { name: string; settings: unknown })
    expect(written.find(row => row.name === LEGACY)?.settings).toEqual(LEGACY_GARAMOND_STYLE_SET)
    expect(written.find(row => row.name === HOUSE)?.settings).toEqual(AUBREY_HOUSE_STYLE_SET)
  })

  it('recognises rows it wrote before and creates nothing', async () => {
    stubDb([
      { id: 'a', name: LEGACY, settings: LEGACY_GARAMOND_STYLE_SET },
      { id: 'b', name: HOUSE, settings: AUBREY_HOUSE_STYLE_SET },
    ])
    const result = await seedStyleSets()
    expect(result.created).toEqual([])
    expect(result.unchanged).toEqual([LEGACY, HOUSE])
    expect(insert).not.toHaveBeenCalled()
  })

  it('leaves an edited style set alone and says so', async () => {
    // Re-running the seed must not undo somebody's tuning of the house style.
    stubDb([{ id: 'b', name: HOUSE, settings: PRESERVE_ALL_SETTINGS }])
    const result = await seedStyleSets()
    expect(result.preserved).toEqual([HOUSE])
    expect(result.unchanged).toEqual([])
    // The missing one is still created; one edited row does not stop the rest.
    expect(result.created).toEqual([LEGACY])
  })

  it('treats a name as taken regardless of case', async () => {
    stubDb([{ id: 'b', name: 'AUBREY LAW HOUSE STYLE', settings: AUBREY_HOUSE_STYLE_SET }])
    const result = await seedStyleSets()
    expect(result.created).toEqual([LEGACY])
  })

  it('preserves rather than replaces a row whose settings no longer parse', async () => {
    stubDb([{ id: 'b', name: HOUSE, settings: { body: { fontSizePt: -4 } } }])
    const result = await seedStyleSets()
    expect(result.preserved).toEqual([HOUSE])
    expect(insert).toHaveBeenCalledTimes(1) // only the missing legacy one
  })

  it('surfaces a read failure rather than seeding over an unknown table state', async () => {
    from.mockImplementation(() => ({
      select: () => ({ is: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }),
    }))
    await expect(seedStyleSets()).rejects.toThrow('nope')
    expect(insert).not.toHaveBeenCalled()
  })
})
