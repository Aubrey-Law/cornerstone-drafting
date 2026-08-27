import { describe, expect, it } from 'vitest'
import {
  MAX_PINNED_MATTERS,
  mergeUserPreferences,
  parseUserPreferences,
  type UserPreferences,
} from '@/lib/userPreferences'

/**
 * `parseUserPreferences` returns a literal object and `mergeUserPreferences`
 * merges one section at a time, so a new top-level key is dropped on read *and*
 * never applied on write unless both are extended. Dropping it on read is the
 * dangerous half: the PATCH route parses the stored row before merging, so an
 * unparsed section would be erased from the database by the next unrelated save.
 *
 * None of that surfaces as an error — the pins would simply stop persisting — so
 * the round trip is asserted here.
 */
describe('nav preferences round trip', () => {
  it('survives parse → merge → parse', () => {
    const stored = parseUserPreferences({ nav: { pinnedMatterIds: ['a', 'b'] } })
    expect(stored.nav?.pinnedMatterIds).toEqual(['a', 'b'])

    const merged = mergeUserPreferences(stored, { nav: { pinnedMatterIds: ['b', 'c'] } })
    expect(parseUserPreferences(merged).nav?.pinnedMatterIds).toEqual(['b', 'c'])
  })

  it('does not erase pins when an unrelated section is patched', () => {
    const stored = parseUserPreferences({ nav: { pinnedMatterIds: ['a'] } })
    const merged = mergeUserPreferences(stored, { drafting: { designView: 'guided' } })
    expect(merged.nav?.pinnedMatterIds).toEqual(['a'])
  })

  it('replaces the pinned list wholesale rather than merging it element-wise', () => {
    // Unpinning has to be expressible, which an element-wise merge could not do.
    const stored = parseUserPreferences({ nav: { pinnedMatterIds: ['a', 'b', 'c'] } })
    const merged = mergeUserPreferences(stored, { nav: { pinnedMatterIds: ['c'] } })
    expect(merged.nav?.pinnedMatterIds).toEqual(['c'])
  })

  it('preserves order, since the list is what drives pin ordering', () => {
    const parsed = parseUserPreferences({ nav: { pinnedMatterIds: ['z', 'a', 'm'] } })
    expect(parsed.nav?.pinnedMatterIds).toEqual(['z', 'a', 'm'])
  })

  it('drops non-string entries and duplicates', () => {
    const parsed = parseUserPreferences({
      nav: { pinnedMatterIds: ['a', 42, 'a', null, 'b'] },
    })
    expect(parsed.nav?.pinnedMatterIds).toEqual(['a', 'b'])
  })

  it('caps the list so the sidebar read stays bounded', () => {
    const many = Array.from({ length: MAX_PINNED_MATTERS + 10 }, (_, i) => `m${i}`)
    const parsed = parseUserPreferences({ nav: { pinnedMatterIds: many } })
    expect(parsed.nav?.pinnedMatterIds).toHaveLength(MAX_PINNED_MATTERS)
  })

  it('tolerates a malformed or absent nav section', () => {
    expect(parseUserPreferences({}).nav).toBeUndefined()
    expect(parseUserPreferences({ nav: null }).nav).toBeUndefined()
    expect(parseUserPreferences({ nav: [] }).nav).toBeUndefined()
    expect(parseUserPreferences({ nav: { pinnedMatterIds: 'nope' } }).nav).toEqual({})
  })

  it('leaves the existing drafting and models sections intact', () => {
    const stored: UserPreferences = parseUserPreferences({
      drafting: { designView: 'express' },
      models: { defaultProvider: 'anthropic' },
      nav: { pinnedMatterIds: ['a'] },
    })
    const merged = mergeUserPreferences(stored, { nav: { pinnedMatterIds: [] } })
    expect(merged.drafting?.designView).toBe('express')
    expect(merged.models?.defaultProvider).toBe('anthropic')
    expect(merged.nav?.pinnedMatterIds).toEqual([])
  })
})
