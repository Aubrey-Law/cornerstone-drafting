import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildMatterTaskInserts,
  daysBetween,
  delayDaysFor,
  dueTone,
  isDateKey,
  parseTemplateTask,
  parseTemplateTasks,
  shiftDownstreamTasks,
  summarizeSlaProgress,
} from '@/lib/slaTasks/schedule'
import type { MatterTaskRow, SlaTemplateTask } from '@/lib/slaTasks/types'

/**
 * The SLA plan is a pile of date arithmetic, and every date it produces is a
 * commitment shown to a client. These cover the cases that bite: DST, the
 * clock-pause shift, and template entries that arrive half-filled.
 */

function templateTask(overrides: Partial<SlaTemplateTask> = {}): SlaTemplateTask {
  return {
    phase: 'onboarding',
    name: 'Task',
    due_offset_days: 7,
    nudge_offset_days: null,
    nudge_tier: null,
    escalation_offset_days: null,
    escalation_tier: null,
    assignee: 'attorney',
    skill: null,
    auto: false,
    conditional: false,
    pauses_clock: false,
    ...overrides,
  }
}

function matterTask(overrides: Partial<MatterTaskRow> = {}): MatterTaskRow {
  return {
    id: 'task-1',
    matter_id: 'matter-1',
    template_id: 'template-1',
    phase: 'onboarding',
    name: 'Task',
    sort_order: 0,
    assignee: 'attorney',
    skill: null,
    conditional: false,
    pauses_clock: false,
    start_date: '2026-03-01',
    due_date: '2026-03-08',
    nudge_date: null,
    nudge_tier: null,
    escalation_date: null,
    escalation_tier: null,
    status: 'pending',
    completed_at: null,
    skipped_at: null,
    notes: null,
    paused_at: null,
    total_paused_days: 0,
    nudge_sent_at: null,
    escalation_sent_at: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

describe('date keys', () => {
  it('adds days across a DST boundary without drifting', () => {
    // US DST starts 2026-03-08. Naive local-midnight arithmetic loses an hour
    // here and lands on the 14th.
    expect(addDays('2026-03-01', 14)).toBe('2026-03-15')
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08')
  })

  it('handles month and year rollover', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('measures whole days in both directions', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14)
    expect(daysBetween('2026-03-15', '2026-03-01')).toBe(-14)
  })

  it('rejects malformed and impossible dates', () => {
    expect(isDateKey('2026-03-01')).toBe(true)
    expect(isDateKey('2026-02-31')).toBe(false)
    expect(isDateKey('2026-3-1')).toBe(false)
    expect(isDateKey('2026-03-01T00:00:00Z')).toBe(false)
    expect(isDateKey(null)).toBe(false)
  })
})

describe('parseTemplateTask', () => {
  it('drops entries with no name or no due offset', () => {
    expect(parseTemplateTask({ name: 'x' })).toBeNull()
    expect(parseTemplateTask({ due_offset_days: 3 })).toBeNull()
    expect(parseTemplateTask(null)).toBeNull()
  })

  it('keeps a nudge tier only when there is a nudge date to act on', () => {
    const withoutDate = parseTemplateTask({
      name: 'x',
      due_offset_days: 3,
      nudge_tier: 'gentle',
    })
    expect(withoutDate?.nudge_tier).toBeNull()

    const withDate = parseTemplateTask({
      name: 'x',
      due_offset_days: 3,
      nudge_offset_days: 1,
      nudge_tier: 'nonsense',
    })
    // An unrecognized tier still has a date to fire on, so it falls back rather
    // than silently dropping the nudge.
    expect(withDate?.nudge_tier).toBe('gentle')
  })

  it('skips unusable entries but keeps the rest of the array', () => {
    expect(parseTemplateTasks([{ name: 'a', due_offset_days: 0 }, { name: '' }, 7])).toHaveLength(1)
    expect(parseTemplateTasks('not an array')).toEqual([])
  })
})

describe('buildMatterTaskInserts', () => {
  it('dates every task off the start date and preserves template order', () => {
    const rows = buildMatterTaskInserts(
      [
        templateTask({ name: 'First', due_offset_days: 0 }),
        templateTask({
          name: 'Second',
          due_offset_days: 7,
          nudge_offset_days: 5,
          nudge_tier: 'gentle',
          escalation_offset_days: 9,
          escalation_tier: 'firm',
        }),
      ],
      { matterId: 'matter-1', templateId: 'template-1', startDate: '2026-03-01' },
    )

    expect(rows.map(row => row.sort_order)).toEqual([0, 1])
    expect(rows[0].due_date).toBe('2026-03-01')
    expect(rows[0].nudge_date).toBeNull()
    expect(rows[1]).toMatchObject({
      due_date: '2026-03-08',
      nudge_date: '2026-03-06',
      nudge_tier: 'gentle',
      escalation_date: '2026-03-10',
      escalation_tier: 'firm',
      start_date: '2026-03-01',
    })
  })
})

describe('clock pausing', () => {
  it('charges only the overrun, and nothing for finishing early', () => {
    expect(delayDaysFor('2026-03-08', '2026-03-14T15:00:00Z')).toBe(6)
    expect(delayDaysFor('2026-03-08', '2026-03-08T15:00:00Z')).toBe(0)
    expect(delayDaysFor('2026-03-08', '2026-03-02T15:00:00Z')).toBe(0)
  })

  it('shifts open downstream tasks and leaves resolved ones alone', () => {
    const tasks = [
      matterTask({ id: 'a', sort_order: 0, due_date: '2026-03-08' }),
      matterTask({ id: 'b', sort_order: 1, due_date: '2026-03-11', status: 'completed' }),
      matterTask({
        id: 'c',
        sort_order: 2,
        due_date: '2026-03-15',
        nudge_date: '2026-03-13',
        escalation_date: '2026-03-17',
      }),
    ]

    const shifted = shiftDownstreamTasks(tasks, 0, 6)
    expect(shifted).toEqual([
      { id: 'c', due_date: '2026-03-21', nudge_date: '2026-03-19', escalation_date: '2026-03-23' },
    ])
  })

  it('moves the pausing task too when a resume is inclusive', () => {
    const tasks = [
      matterTask({ id: 'a', sort_order: 0, due_date: '2026-03-08' }),
      matterTask({ id: 'b', sort_order: 1, due_date: '2026-03-15' }),
    ]
    expect(shiftDownstreamTasks(tasks, 0, 3, { inclusive: true }).map(row => row.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('never shifts backwards', () => {
    expect(shiftDownstreamTasks([matterTask({ sort_order: 1 })], 0, 0)).toEqual([])
    expect(shiftDownstreamTasks([matterTask({ sort_order: 1 })], 0, -4)).toEqual([])
  })
})

describe('dueTone', () => {
  const today = '2026-03-10'

  it('bands a due date red, amber, then green', () => {
    expect(dueTone(matterTask({ due_date: '2026-03-09' }), today)).toBe('overdue')
    expect(dueTone(matterTask({ due_date: '2026-03-10' }), today)).toBe('soon')
    expect(dueTone(matterTask({ due_date: '2026-03-13' }), today)).toBe('soon')
    expect(dueTone(matterTask({ due_date: '2026-03-14' }), today)).toBe('on_track')
  })

  it('stops colouring a task once it is resolved', () => {
    expect(dueTone(matterTask({ due_date: '2026-01-01', status: 'completed' }), today)).toBe('done')
    expect(dueTone(matterTask({ due_date: '2026-01-01', status: 'skipped' }), today)).toBe('done')
  })
})

describe('summarizeSlaProgress', () => {
  const tasks = [
    matterTask({ id: 'a', phase: 'onboarding', sort_order: 0, status: 'completed' }),
    matterTask({ id: 'b', phase: 'onboarding', sort_order: 1, status: 'skipped' }),
    matterTask({ id: 'c', phase: 'design', sort_order: 2, due_date: '2026-03-05' }),
    matterTask({ id: 'd', phase: 'signing', sort_order: 3, due_date: '2026-04-12' }),
  ]

  it('reports the first phase with work left as current', () => {
    const progress = summarizeSlaProgress(tasks, { targetDays: 42, today: '2026-03-10' })
    expect(progress.currentPhase).toBe('design')
    expect(progress.complete).toBe(1)
    expect(progress.total).toBe(4)
    expect(progress.overdue).toBe(1)
    // Phases with no tasks are reported but never become "current".
    expect(progress.phases.find(phase => phase.phase === 'review')?.total).toBe(0)
  })

  it('pushes the target date out by the days the matter has slipped', () => {
    const clean = summarizeSlaProgress(tasks, { targetDays: 42, today: '2026-03-10' })
    expect(clean.targetDate).toBe('2026-04-12')
    expect(clean.daysRemaining).toBe(33)

    const slipped = summarizeSlaProgress(
      tasks.map(task => (task.id === 'c' ? { ...task, total_paused_days: 5 } : task)),
      { targetDays: 42, today: '2026-03-10' },
    )
    expect(slipped.totalPausedDays).toBe(5)
    expect(slipped.targetDate).toBe('2026-04-17')
    expect(slipped.daysRemaining).toBe(38)
  })

  it('has no target when the template did not supply one', () => {
    const progress = summarizeSlaProgress(tasks, { today: '2026-03-10' })
    expect(progress.targetDate).toBeNull()
    expect(progress.daysRemaining).toBeNull()
  })

  it('holds on the last phase once everything is resolved', () => {
    const done = tasks.map(task => ({ ...task, status: 'completed' as const }))
    expect(summarizeSlaProgress(done, { today: '2026-03-10' }).currentPhase).toBe('signing')
  })
})
