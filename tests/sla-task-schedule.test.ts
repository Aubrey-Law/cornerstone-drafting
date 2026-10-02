import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildPlanTaskDrafts,
  daysBetween,
  delayDaysFor,
  dueTone,
  isDateKey,
  parseTemplateTask,
  parseTemplateTasks,
  rescheduleForAnchor,
  rescheduleForGates,
  shiftDownstreamTasks,
  summarizeSlaProgress,
} from '@/lib/slaTasks/schedule'
import type { PlanScheduleFields } from '@/lib/slaTasks/schedule'
import type { SlaTemplateTask } from '@/lib/slaTasks/types'

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
    relative_to: null,
    pre_engagement: false,
    gate: null,
    extends_target_days: null,
    recurring_interval_days: null,
    variant: null,
    triggers_day_zero: false,
    ...overrides,
  }
}

/**
 * The plan projection the schedule math reads — a `tasks` row seen through
 * `toPlanTask`, narrowed to the fields these functions actually touch.
 */
function planTask(overrides: Partial<PlanScheduleFields> = {}): PlanScheduleFields {
  return {
    id: 'task-1',
    sort_order: 0,
    phase: 'onboarding',
    status: 'open',
    plan_template_id: 'template-1',
    notes: null,
    completed_at: null,
    skipped_at: null,
    paused_at: null,
    total_paused_days: 0,
    extends_target_days: null,
    pre_engagement: false,
    relative_to: null,
    due_offset_days: 7,
    nudge_offset_days: null,
    escalation_offset_days: null,
    start_date: '2026-03-01',
    due_date: '2026-03-08',
    nudge_date: null,
    escalation_date: null,
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
  it('drops entries with no name', () => {
    expect(parseTemplateTask({ due_offset_days: 3 })).toBeNull()
    expect(parseTemplateTask(null)).toBeNull()
  })

  it('keeps a named entry with no due offset', () => {
    // On the soft clock the firm sets no deadline for "lead schedules a
    // discovery call" — the task is real, the date is the client's to make.
    expect(parseTemplateTask({ name: 'Lead schedules call' })).toMatchObject({
      name: 'Lead schedules call',
      due_offset_days: null,
    })
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

describe('buildPlanTaskDrafts', () => {
  it('dates every task off the start date and preserves template order', () => {
    const rows = buildPlanTaskDrafts(
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
      planTask({ id: 'a', sort_order: 0, due_date: '2026-03-08' }),
      planTask({ id: 'b', sort_order: 1, due_date: '2026-03-11', status: 'done' }),
      planTask({
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
      planTask({ id: 'a', sort_order: 0, due_date: '2026-03-08' }),
      planTask({ id: 'b', sort_order: 1, due_date: '2026-03-15' }),
    ]
    expect(shiftDownstreamTasks(tasks, 0, 3, { inclusive: true }).map(row => row.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('never shifts backwards', () => {
    expect(shiftDownstreamTasks([planTask({ sort_order: 1 })], 0, 0)).toEqual([])
    expect(shiftDownstreamTasks([planTask({ sort_order: 1 })], 0, -4)).toEqual([])
  })
})

describe('dueTone', () => {
  const today = '2026-03-10'

  it('bands a due date red, amber, then green', () => {
    expect(dueTone(planTask({ due_date: '2026-03-09' }), today)).toBe('overdue')
    expect(dueTone(planTask({ due_date: '2026-03-10' }), today)).toBe('soon')
    expect(dueTone(planTask({ due_date: '2026-03-13' }), today)).toBe('soon')
    expect(dueTone(planTask({ due_date: '2026-03-14' }), today)).toBe('on_track')
  })

  it('stops colouring a task once it is resolved', () => {
    expect(dueTone(planTask({ due_date: '2026-01-01', status: 'done' }), today)).toBe('done')
    expect(dueTone(planTask({ due_date: '2026-01-01', status: 'archived', skipped_at: '2026-03-01T00:00:00Z' }), today)).toBe('done')
  })
})

describe('summarizeSlaProgress', () => {
  const tasks = [
    planTask({ id: 'a', phase: 'onboarding', sort_order: 0, status: 'done' }),
    planTask({ id: 'b', phase: 'onboarding', sort_order: 1, status: 'archived', skipped_at: '2026-03-01T00:00:00Z' }),
    planTask({ id: 'c', phase: 'design', sort_order: 2, due_date: '2026-03-05' }),
    planTask({ id: 'd', phase: 'signing', sort_order: 3, due_date: '2026-04-12' }),
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
    const done = tasks.map(task => ({ ...task, status: 'done' as const }))
    expect(summarizeSlaProgress(done, { today: '2026-03-10' }).currentPhase).toBe('signing')
  })
})

describe('dual clock', () => {
  const anchors = { engagement: '2026-04-01', discovery_call: '2026-03-01', pmps: '2026-03-12' }

  it('dates each task off its own anchor', () => {
    const rows = buildPlanTaskDrafts(
      [
        templateTask({ name: 'Hold discovery call', due_offset_days: 0, relative_to: 'discovery_call' }),
        // Negative offsets run backwards from the anchor: the organizer is due
        // the day before the session.
        templateTask({ name: 'Organizer', due_offset_days: -1, relative_to: 'pmps' }),
        templateTask({ name: 'Client approves design', due_offset_days: 7 }),
      ],
      { matterId: 'matter-1', templateId: 'template-1', startDate: '2026-02-20', anchors },
    )

    expect(rows.map(row => row.due_date)).toEqual(['2026-03-01', '2026-03-11', '2026-04-08'])
  })

  it('falls back to the start date for Day 0 before the engagement is signed', () => {
    const [row] = buildPlanTaskDrafts([templateTask({ due_offset_days: 7 })], {
      matterId: 'matter-1',
      templateId: null,
      startDate: '2026-02-20',
      anchors: { discovery_call: '2026-03-01' },
    })
    expect(row.due_date).toBe('2026-02-27')
  })

  it('leaves a task undated while its anchor is unknown', () => {
    const [row] = buildPlanTaskDrafts(
      [
        templateTask({
          due_offset_days: -1,
          nudge_offset_days: -3,
          nudge_tier: 'gentle',
          relative_to: 'pmps',
        }),
      ],
      { matterId: 'matter-1', templateId: null, startDate: '2026-02-20', anchors: {} },
    )
    expect(row.due_date).toBeNull()
    expect(row.nudge_date).toBeNull()
    // The offsets survive so the task can be dated once the PMPS is booked.
    expect(row.due_offset_days).toBe(-1)
    expect(dueTone({ due_date: row.due_date, status: 'open', skipped_at: null }, '2026-03-01')).toBe(
      'unscheduled',
    )
  })

  it('withholds dates from a task whose gate has not opened', () => {
    const task = templateTask({ due_offset_days: 7, relative_to: 'discovery_call', gate: 'fit_confirmed' })
    const build = (gatesMet: 'fit_confirmed'[]) =>
      buildPlanTaskDrafts([task], {
        matterId: 'matter-1',
        templateId: null,
        startDate: '2026-02-20',
        anchors,
        gatesMet,
      })[0]

    // Still on the checklist either way — a not-a-fit lead should show the task
    // it never reached, rather than a plan with a silent hole in it.
    expect(build([]).due_date).toBeNull()
    expect(build(['fit_confirmed']).due_date).toBe('2026-03-08')
  })

  it('includes variant tasks only for the branch the matter is on', () => {
    const tasks = [
      templateTask({ name: 'Signing meeting held', due_offset_days: 28 }),
      templateTask({ name: 'Mail signing package', due_offset_days: 25, variant: 'remote_signing' }),
    ]
    const options = { matterId: 'matter-1', templateId: null, startDate: '2026-04-01', anchors }

    expect(buildPlanTaskDrafts(tasks, options).map(row => row.name)).toEqual([
      'Signing meeting held',
    ])
    expect(
      buildPlanTaskDrafts(tasks, { ...options, variants: ['remote_signing'] }).map(row => row.name),
    ).toEqual(['Signing meeting held', 'Mail signing package'])
  })
})

describe('rescheduleForAnchor', () => {
  const pending = (overrides: Partial<PlanScheduleFields>) =>
    planTask({ relative_to: 'pmps', due_date: null, due_offset_days: -1, ...overrides })

  it('dates the waiting tasks once the anchor lands', () => {
    const updates = rescheduleForAnchor(
      [
        pending({ id: 'organizer', nudge_offset_days: -3 }),
        pending({ id: 'prep', due_offset_days: -1 }),
        planTask({ id: 'day-zero', relative_to: null, due_offset_days: 7 }),
      ],
      'pmps',
      '2026-03-12',
    )

    expect(updates).toEqual([
      { id: 'organizer', due_date: '2026-03-11', nudge_date: '2026-03-09', escalation_date: null },
      { id: 'prep', due_date: '2026-03-11', nudge_date: null, escalation_date: null },
    ])
  })

  it('leaves resolved tasks on their historical dates', () => {
    const updates = rescheduleForAnchor(
      [pending({ id: 'done', status: 'done', due_date: '2026-03-05' })],
      'pmps',
      '2026-03-12',
    )
    expect(updates).toEqual([])
  })

  it('returns nothing when the anchor has not moved', () => {
    const settled = pending({ id: 'organizer', due_date: '2026-03-11' })
    expect(rescheduleForAnchor([settled], 'pmps', '2026-03-12')).toEqual([])
    // Rebooked a day later, so the date genuinely changes.
    expect(rescheduleForAnchor([settled], 'pmps', '2026-03-13')).toEqual([
      { id: 'organizer', due_date: '2026-03-12', nudge_date: null, escalation_date: null },
    ])
  })
})

describe('target date extensions', () => {
  it('pushes the target out when a Round 2 revision is on the plan', () => {
    const tasks = [
      planTask({ id: 'a', phase: 'client_review' }),
      planTask({ id: 'b', phase: 'client_review', extends_target_days: 5 }),
    ]
    expect(summarizeSlaProgress(tasks, { targetDays: 28, today: '2026-03-01' }).targetDate).toBe(
      '2026-04-03',
    )

    // Skipping it puts the original commitment back.
    const skipped = tasks.map(task =>
      task.id === 'b'
        ? { ...task, status: 'archived' as const, skipped_at: '2026-03-01T00:00:00Z' }
        : task,
    )
    expect(summarizeSlaProgress(skipped, { targetDays: 28, today: '2026-03-01' }).targetDate).toBe(
      '2026-03-29',
    )
  })
})

describe('a lead has no Day 0 yet', () => {
  const preEngagement = templateTask({
    name: 'Hold discovery call', due_offset_days: 0, relative_to: 'discovery_call', pre_engagement: true,
  })
  const dayZero = templateTask({ name: 'Client approves design', due_offset_days: 7 })

  it('leaves Day-0 tasks undated while the engagement is unsigned', () => {
    // The whole point of the soft clock: an unsigned matter must not show a
    // 28-day plan counted from the day the lead happened to be created.
    const rows = buildPlanTaskDrafts([preEngagement, dayZero], {
      matterId: 'm', templateId: null, startDate: '2026-03-01',
      anchors: { discovery_call: '2026-03-05' },
    })
    expect(rows[0].due_date).toBe('2026-03-05')
    expect(rows[1].due_date).toBeNull()
  })

  it('dates Day-0 tasks once the engagement date is known', () => {
    const rows = buildPlanTaskDrafts([preEngagement, dayZero], {
      matterId: 'm', templateId: null, startDate: '2026-03-01',
      anchors: { discovery_call: '2026-03-05', engagement: '2026-04-01' },
    })
    expect(rows[1].due_date).toBe('2026-04-08')
  })

  it('still dates a template with no pre-engagement work from its start date', () => {
    // v1 is only ever generated at hire, where the start date *is* Day 0, so
    // removing its fallback would have broken every existing matter.
    const [row] = buildPlanTaskDrafts([dayZero], {
      matterId: 'm', templateId: null, startDate: '2026-03-01', anchors: {},
    })
    expect(row.due_date).toBe('2026-03-08')
  })

  it('starts the firm clock when the engagement anchor lands', () => {
    const tasks = [
      planTask({ id: 'design', relative_to: null, due_offset_days: 7, due_date: null }),
      planTask({ id: 'sign', relative_to: null, due_offset_days: 28, due_date: null }),
      planTask({ id: 'pmps', relative_to: 'pmps', due_offset_days: -1, due_date: '2026-03-11' }),
    ]
    const updates = rescheduleForAnchor(tasks, 'engagement', '2026-04-01')
    expect(updates).toEqual([
      { id: 'design', due_date: '2026-04-08', nudge_date: null, escalation_date: null },
      { id: 'sign', due_date: '2026-04-29', nudge_date: null, escalation_date: null },
    ])
  })
})

/**
 * The fit decision is a gate. Picking "Proceed — good fit" used to save and
 * change nothing: generation had left the gated tasks undated and nothing ever
 * revisited them. And a discovery-call date dated them with no decision made.
 */
describe('fit gate', () => {
  const gated = (overrides: Partial<PlanScheduleFields> = {}) => ({
    ...planTask({ relative_to: 'discovery_call', due_date: null, due_offset_days: 7, ...overrides }),
    gate: 'fit_confirmed' as const,
  })

  it('does not date a gated task from its anchor while the gate is closed', () => {
    expect(rescheduleForAnchor([gated({ id: 'pmps-link' })], 'discovery_call', '2026-03-02', [])).toEqual([])
  })

  it('dates it from its anchor once the gate is open', () => {
    expect(rescheduleForAnchor([gated({ id: 'pmps-link' })], 'discovery_call', '2026-03-02', ['fit_confirmed']))
      .toEqual([{ id: 'pmps-link', due_date: '2026-03-09', nudge_date: null, escalation_date: null }])
  })

  it('keeps the previous behaviour when no gates are passed', () => {
    expect(rescheduleForAnchor([gated({ id: 'pmps-link' })], 'discovery_call', '2026-03-02')).toHaveLength(1)
  })

  it('schedules the gated tasks when the gate opens, from the dates already set', () => {
    const updates = rescheduleForGates(
      [gated({ id: 'email', due_offset_days: 0 }), gated({ id: 'organizer', relative_to: 'pmps', due_offset_days: -1 })],
      { discovery_call: '2026-03-02', pmps: '2026-03-20' },
      ['fit_confirmed'],
    )
    expect(updates).toEqual([
      { id: 'email', due_date: '2026-03-02', nudge_date: null, escalation_date: null },
      { id: 'organizer', due_date: '2026-03-19', nudge_date: null, escalation_date: null },
    ])
  })

  it('leaves a gated task undated when its anchor is not set yet', () => {
    expect(rescheduleForGates([gated({ id: 'organizer', relative_to: 'pmps' })], {}, ['fit_confirmed'])).toEqual([])
  })

  it('takes the dates back off when the gate closes again', () => {
    expect(rescheduleForGates([gated({ id: 'email', due_date: '2026-03-02' })], { discovery_call: '2026-03-02' }, []))
      .toEqual([{ id: 'email', due_date: null, nudge_date: null, escalation_date: null }])
  })

  it('never touches ungated or finished tasks', () => {
    const ungated = planTask({ id: 'call', relative_to: 'discovery_call', due_date: null, due_offset_days: 1 })
    const done = gated({ id: 'sent', status: 'done', due_date: '2026-03-02' })
    expect(rescheduleForGates([ungated, done], { discovery_call: '2026-03-02' }, [])).toEqual([])
  })
})
