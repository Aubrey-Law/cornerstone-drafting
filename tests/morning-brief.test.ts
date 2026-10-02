import { describe, expect, it } from 'vitest'
import { buildMorningBrief } from '@/lib/work/morningBrief'
import type { DailyPlanPreview, WorkItem } from '@/lib/work/types'

function item(workKey: string, title: string): WorkItem {
  return {
    workKey, sourceType: 'task', sourceIds: [workKey], evidence: [],
    record: { type: 'matter', id: 'matter-1', name: 'Client' }, title, actionLabel: 'Open', href: '/admin/tasks',
    owner: 'firm', state: 'open', priorityBand: 1, priorityReasons: [], estimateMinutes: 15,
  }
}

function preview(): DailyPlanPreview {
  const saved = item('saved', 'Saved committed action')
  const newlyRanked = item('new', 'Newly ranked action')
  return {
    date: '2026-10-02', now: newlyRanked, mustDo: [newlyRanked], communication: [], suggested: [saved], waiting: [], later: [], appointments: [], blocks: [],
    capacityMinutes: 240, plannedMinutes: 30, criticalMinutes: 0, overload: false, overloadMinutes: 0,
  }
}

describe('morning brief', () => {
  it('uses the exact committed lanes instead of injecting a fresh ranking', () => {
    const brief = buildMorningBrief(preview(), {
      status: 'committed',
      items: [{ work_key: 'saved', lane: 'suggested', position: 0, status: 'planned' }],
    })

    expect(brief.usesCommittedAgenda).toBe(true)
    expect(brief.mustDo).toEqual([])
    expect(brief.suggested.map(item => item.workKey)).toEqual(['saved'])
    expect(brief.now?.workKey).toBe('saved')
  })

  it('uses the current deterministic preview before commitment', () => {
    const brief = buildMorningBrief(preview(), null)

    expect(brief.usesCommittedAgenda).toBe(false)
    expect(brief.mustDo.map(item => item.workKey)).toEqual(['new'])
  })
})
