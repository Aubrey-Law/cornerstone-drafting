import { describe, expect, it } from 'vitest'
import {
  buildRelationshipPickerOptions,
  contactProfileRelationshipPatch,
  decodeRelationshipSelection,
  encodeRelationshipSelection,
  getRelationshipLabel,
  legacyRelationshipToStructured,
  structuredFromContactProfile,
} from '@/lib/kinship/relationshipLabels'

describe('kinship relationship labels', () => {
  it('encodes and decodes picker values', () => {
    const value = encodeRelationshipSelection('client', 'sibling_sister')
    expect(decodeRelationshipSelection(value)).toEqual({
      anchor: 'client',
      kind: 'sibling_sister',
    })
  })

  it('derives sister-in-law for spouse perspective when anchored to client', () => {
    const rel = { anchor: 'client' as const, kind: 'sibling_sister' as const }
    expect(getRelationshipLabel(rel, 'client')).toBe('sister')
    expect(getRelationshipLabel(rel, 'spouse')).toBe('sister-in-law')
  })

  it('derives sister-in-law for client perspective when anchored to spouse', () => {
    const rel = { anchor: 'spouse' as const, kind: 'sibling_sister' as const }
    expect(getRelationshipLabel(rel, 'spouse')).toBe('sister')
    expect(getRelationshipLabel(rel, 'client')).toBe('sister-in-law')
  })

  it('keeps professional relationships stable across perspectives', () => {
    const rel = { anchor: 'client' as const, kind: 'attorney' as const }
    expect(getRelationshipLabel(rel, 'client')).toBe('attorney')
    expect(getRelationshipLabel(rel, 'spouse')).toBe('attorney')
  })

  it('maps legacy free-text sister to structured sibling_sister', () => {
    expect(legacyRelationshipToStructured('client', 'sister')).toEqual({
      anchor: 'client',
      kind: 'sibling_sister',
    })
  })

  it('persists structured fields and client-perspective detail on save patch', () => {
    const rel = { anchor: 'client' as const, kind: 'sibling_sister' as const }
    expect(contactProfileRelationshipPatch(rel, 'client')).toMatchObject({
      relationship_to: 'client',
      relationship_kind: 'sibling_sister',
      relationship_detail: 'sister',
    })
    expect(getRelationshipLabel(rel, 'spouse')).toBe('sister-in-law')
  })

  it('reads structured relationship from contact profile', () => {
    expect(structuredFromContactProfile({
      relationship_to: 'client',
      relationship_kind: 'sibling_brother',
    })).toMatchObject({
      anchor: 'client',
      kind: 'sibling_brother',
    })
  })

  it('builds grouped picker labels with client and spouse names', () => {
    const options = buildRelationshipPickerOptions({
      clientName: 'Julie Venables',
      spouseName: 'John Venables',
    })
    expect(options.some(o => o.label === "Julie Venables's Sister")).toBe(true)
    expect(options.some(o => o.label === "John Venables's Sister")).toBe(true)
  })
})
