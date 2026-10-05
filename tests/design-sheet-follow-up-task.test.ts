import { describe, expect, it } from 'vitest'
import {
  followUpDescription,
  followUpItemText,
  followUpItems,
  mergeFollowUpChecklist,
} from '@/lib/designMeeting/followUpTask'
import type { DesignReadinessBlocker } from '@/lib/designSheetReadiness'

function blocker(
  label: string,
  category: DesignReadinessBlocker['category'],
  blocking = true,
  sectionLabel = 'Trust Details',
): DesignReadinessBlocker {
  return {
    id: `trust:${label}`,
    sectionId: 'trust',
    sectionLabel,
    label,
    targetField: null,
    targetId: 'trust',
    category,
    blocking,
  }
}

describe('followUpItems', () => {
  it('says who has to act on each item', () => {
    expect(followUpItemText(blocker('trust name', 'required'))).toBe('Needed — Trust Details: trust name')
    expect(followUpItemText(blocker('signing date', 'client-decision', false)))
      .toBe('Ask client — Trust Details: signing date (optional)')
    expect(followUpItemText(blocker('attorney approval', 'approval'))).toBe('Attorney sign-off — Trust Details: attorney approval')
  })

  it('keeps every blocking item and only the client questions among the optional ones', () => {
    const items = followUpItems(
      [blocker('trust name', 'required')],
      [
        blocker('signing date', 'client-decision', false),
        blocker('agent compensation', 'required', false),
      ],
    )
    expect(items).toEqual([
      'Needed — Trust Details: trust name',
      'Ask client — Trust Details: signing date (optional)',
    ])
  })

  it('puts blocking items first and client questions ahead of the rest', () => {
    const items = followUpItems(
      [blocker('attorney approval', 'approval'), blocker('trust name', 'required'), blocker('gift', 'client-decision')],
      [blocker('signing date', 'client-decision', false)],
    )
    expect(items.map(item => item.split(' — ')[0])).toEqual([
      'Ask client',
      'Needed',
      'Attorney sign-off',
      'Ask client',
    ])
  })

  it('lists an item once even when readiness reports it twice', () => {
    const items = followUpItems([blocker('trust name', 'required'), blocker('trust name', 'required')], [])
    expect(items).toHaveLength(1)
  })
})

describe('mergeFollowUpChecklist', () => {
  it('ticks items that have since been answered and appends new gaps', () => {
    const merged = mergeFollowUpChecklist(
      [
        { text: 'Needed — Trust Details: trust name', done: false },
        { text: 'Ask client — Family: children', done: false },
      ],
      ['Ask client — Family: children', 'Ask client — Health Care: anatomical gift election'],
    )
    expect(merged).toEqual([
      { text: 'Needed — Trust Details: trust name', done: true },
      { text: 'Ask client — Family: children', done: false },
      { text: 'Ask client — Health Care: anatomical gift election', done: false },
    ])
  })

  it('leaves an item the attorney ticked alone while it is still open', () => {
    const merged = mergeFollowUpChecklist(
      [{ text: 'Ask client — Family: children', done: true }],
      ['Ask client — Family: children'],
    )
    expect(merged).toEqual([{ text: 'Ask client — Family: children', done: true }])
  })
})

describe('followUpDescription', () => {
  it('says how much is blocking', () => {
    expect(followUpDescription(2, 5)).toContain('2 items block document generation')
    expect(followUpDescription(0, 1)).toContain('Nothing is blocking')
  })
})
