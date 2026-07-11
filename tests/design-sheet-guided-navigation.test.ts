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
})
