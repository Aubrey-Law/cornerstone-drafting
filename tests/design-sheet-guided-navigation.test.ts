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

  it('returns the next blocker after the active section and wraps', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client' },
      { id: 'trust:name', sectionId: 'trust' },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'client')?.id).toBe('trust:name')
    expect(findNextUnresolvedBlocker(blockers, 'trust')?.id).toBe('client:name')
  })

  it('skips every blocker in the active section before wrapping to another section', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client' },
      { id: 'client:address', sectionId: 'client' },
      { id: 'trust:name', sectionId: 'trust' },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'client')?.id).toBe('trust:name')
    expect(findNextUnresolvedBlocker(blockers, 'trust')?.id).toBe('client:name')
  })

  it('advances from a middle section past its full blocker run before wrapping', () => {
    const blockers = [
      { id: 'client:name', sectionId: 'client' },
      { id: 'family:child-name', sectionId: 'family' },
      { id: 'family:child-birth-date', sectionId: 'family' },
      { id: 'trust:name', sectionId: 'trust' },
    ] as any

    expect(findNextUnresolvedBlocker(blockers, 'family')?.id).toBe('trust:name')
  })
})
