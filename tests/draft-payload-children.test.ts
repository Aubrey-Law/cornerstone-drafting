import { describe, expect, it } from 'vitest'

import { draftPayloadChildren } from '@/lib/buildDraftPayload'

// `designSheet.children` is loosely shaped at runtime: most rows have a
// composed `name`, but some carry the intake first/middle/last shape and a few
// legacy rows are missing a name entirely. draftPayloadChildren must never crash.
type LooseSheet = Parameters<typeof draftPayloadChildren>[0]

describe('draftPayloadChildren', () => {
  it('uses the composed name when present', () => {
    const sheet = { children: [{ name: 'Mary Smith', dob: '2010-01-01', relationship: 'biological', is_minor: true }] }
    expect(draftPayloadChildren(sheet as unknown as LooseSheet)).toEqual([
      { full_name: 'Mary Smith', dob: '2010-01-01', relationship: 'biological', minor: true },
    ])
  })

  it('composes the name from first/middle/last when there is no `name`', () => {
    const sheet = { children: [{ first_name: 'Mary', middle_name: 'Anne', last_name: 'Smith' }] }
    expect(draftPayloadChildren(sheet as unknown as LooseSheet)[0].full_name).toBe('Mary Anne Smith')
  })

  it('does not throw on a child with no usable name and drops it', () => {
    const sheet = { children: [{ dob: '2015-05-05' }, { name: '   ' }, null] }
    expect(() => draftPayloadChildren(sheet as unknown as LooseSheet)).not.toThrow()
    expect(draftPayloadChildren(sheet as unknown as LooseSheet)).toEqual([])
  })

  it('returns an empty array when children is missing or not an array', () => {
    expect(draftPayloadChildren(null)).toEqual([])
    expect(draftPayloadChildren({ children: {} } as unknown as LooseSheet)).toEqual([])
  })
})
