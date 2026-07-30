import { describe, expect, it } from 'vitest'
import { findNextUnresolvedBlocker, groupGuidedSections } from '@/lib/designSheet/guidedNavigation'

describe('guided design sheet navigation', () => {
  it('keeps catalog order inside guided status groups', () => {
    const sections = [{ id: 'client' }, { id: 'family' }, { id: 'plan' }, { id: 'trust' }]
    const summaries = {
      client: { status: 'complete', detail: null },
      family: { status: 'none', detail: null },
      plan: { status: 'attention', detail: null },
      trust: { status: 'attention', detail: null },
    } as const

    expect(groupGuidedSections(sections, summaries)).toEqual({
      attention: [sections[2], sections[3]],
      remaining: [sections[1]],
      complete: [sections[0]],
    })
  })

  it('preserves blocker counts on attention summaries and completed catalog order', () => {
    const sections = [{ id: 'client' }, { id: 'family' }, { id: 'plan' }, { id: 'trust' }]
    const summaries = {
      client: { status: 'complete', detail: null, blockers: [] },
      family: { status: 'attention', detail: null, blockers: [{ id: 'one' }, { id: 'two' }] },
      plan: { status: 'complete', detail: null, blockers: [] },
      trust: { status: 'attention', detail: null, blockers: [{ id: 'three' }] },
    } as any

    const groups = groupGuidedSections(sections, summaries)
    expect(groups.attention.map(section => summaries[section.id].blockers.length)).toEqual([2, 1])
    expect(groups.complete).toEqual([sections[0], sections[2]])
  })

  it('returns the next blocker after the active section and wraps', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client', blocking: true },
      { id: 'trust:name', sectionId: 'trust', blocking: true },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'client')?.id).toBe('trust:name')
    expect(findNextUnresolvedBlocker(blockers, 'trust')?.id).toBe('client:name')
  })

  it('skips every blocker in the active section before wrapping to another section', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client', blocking: true },
      { id: 'client:address', sectionId: 'client', blocking: true },
      { id: 'trust:name', sectionId: 'trust', blocking: true },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'client')?.id).toBe('trust:name')
    expect(findNextUnresolvedBlocker(blockers, 'trust')?.id).toBe('client:name')
  })

  it('advances from a middle section past its full blocker run before wrapping', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client', blocking: true },
      { id: 'family:child-name', sectionId: 'family', blocking: true },
      { id: 'family:child-birth-date', sectionId: 'family', blocking: true },
      { id: 'trust:name', sectionId: 'trust', blocking: true },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'family')?.id).toBe('trust:name')
  })

  it('returns null when no unresolved blocker remains', () => {
    expect(findNextUnresolvedBlocker([], 'client')).toBeNull()
  })

  it('skips optional readiness items', () => {
    const items = [
      { id: 'trust:backup', sectionId: 'trust', blocking: false },
      { id: 'trust:primary', sectionId: 'trust', blocking: true },
    ] as any

    expect(findNextUnresolvedBlocker(items)?.id).toBe('trust:primary')
  })
})
