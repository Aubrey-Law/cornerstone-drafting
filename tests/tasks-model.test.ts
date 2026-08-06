import { describe, expect, it } from 'vitest'
import {
  compareTasks,
  effectiveDueAt,
  isTaskOverdue,
  taskDueGroup,
  taskProgress,
  taskRecordHref,
  type TaskRow,
} from '@/lib/tasks/types'
import { nextOccurrence, parseRecurrence } from '@/lib/tasks/recurrence'
import { parseCapture } from '@/lib/tasks/parseCapture'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: 'Call the client',
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'manual',
    task_type: 'single',
    checklist: [],
    matter_id: null,
    lead_id: null,
    stage_key: null,
    stage_entered_at: null,
    batch_tag: null,
    soft_due_at: null,
    hard_due_at: null,
    due_at: null,
    assignee_id: null,
    estimate_minutes: null,
    remind_at: null,
    recurrence: null,
    template_id: null,
    document_id: null,
    completed_at: null,
    completed_by: null,
    created_by: null,
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
    ...overrides,
  }
}

// Noon UTC is mid-morning in the firm's timezone, so these fixtures never sit
// on a date boundary.
const NOW = new Date('2026-07-29T16:00:00.000Z')

describe('effective due date', () => {
  it('prefers due_at, then the soft date, then the SLA', () => {
    expect(effectiveDueAt(task({ due_at: 'A', soft_due_at: 'B', hard_due_at: 'C' }))).toBe('A')
    expect(effectiveDueAt(task({ soft_due_at: 'B', hard_due_at: 'C' }))).toBe('B')
    expect(effectiveDueAt(task({ hard_due_at: 'C' }))).toBe('C')
    expect(effectiveDueAt(task())).toBeNull()
  })

  it('reads a stage task off its soft date, not its SLA', () => {
    const stage = task({
      source: 'stage',
      soft_due_at: '2026-07-28T16:00:00.000Z',
      hard_due_at: '2026-08-04T16:00:00.000Z',
    })
    expect(taskDueGroup(stage, NOW)).toBe('overdue')
  })
})

describe('due-date grouping', () => {
  it('splits open tasks into overdue, today, this week and later', () => {
    expect(taskDueGroup(task({ due_at: '2026-07-28T16:00:00.000Z' }), NOW)).toBe('overdue')
    expect(taskDueGroup(task({ due_at: '2026-07-29T20:00:00.000Z' }), NOW)).toBe('today')
    expect(taskDueGroup(task({ due_at: '2026-07-31T16:00:00.000Z' }), NOW)).toBe('week')
    expect(taskDueGroup(task({ due_at: '2026-08-20T16:00:00.000Z' }), NOW)).toBe('later')
    expect(taskDueGroup(task(), NOW)).toBe('none')
  })

  it('never calls a completed task overdue', () => {
    const done = task({ status: 'done', due_at: '2026-01-01T16:00:00.000Z' })
    expect(taskDueGroup(done, NOW)).toBe('done')
    expect(isTaskOverdue(done, NOW)).toBe(false)
  })

  it('treats in-progress and blocked as still open', () => {
    expect(taskDueGroup(task({ status: 'in_progress', due_at: '2026-07-28T16:00:00.000Z' }), NOW)).toBe('overdue')
    expect(taskDueGroup(task({ status: 'blocked', due_at: '2026-07-28T16:00:00.000Z' }), NOW)).toBe('overdue')
  })
})

describe('sorting', () => {
  it('puts the soonest due first, undated last, and breaks ties on priority', () => {
    const soon = task({ id: 'soon', due_at: '2026-07-29T16:00:00.000Z' })
    const later = task({ id: 'later', due_at: '2026-08-29T16:00:00.000Z' })
    const undated = task({ id: 'undated' })
    const undatedHigh = task({ id: 'undated-high', priority: 'high' })

    const sorted = [undated, later, undatedHigh, soon].sort(compareTasks).map(t => t.id)
    expect(sorted).toEqual(['soon', 'later', 'undated-high', 'undated'])
  })
})

describe('progress', () => {
  it('counts checklist items, and a single task as one step', () => {
    expect(taskProgress(task())).toEqual({ done: 0, total: 1, isComplete: false })
    expect(
      taskProgress(task({
        task_type: 'checklist',
        checklist: [{ text: 'a', done: true }, { text: 'b', done: false }],
      })),
    ).toEqual({ done: 1, total: 2, isComplete: false })
    expect(
      taskProgress(task({
        task_type: 'checklist',
        checklist: [{ text: 'a', done: true }],
      })),
    ).toEqual({ done: 1, total: 1, isComplete: true })
  })
})

describe('record links', () => {
  it('points at the matter or the lead, and nowhere when unattached', () => {
    expect(taskRecordHref(task({ matter_id: 'm1' }))).toBe('/admin/matters/m1')
    expect(taskRecordHref(task({ lead_id: 'l1' }))).toBe('/admin/crm/opportunities/l1')
    expect(taskRecordHref(task())).toBeNull()
  })
})

describe('recurrence', () => {
  it('rejects malformed jsonb', () => {
    expect(parseRecurrence(null)).toBeNull()
    expect(parseRecurrence({ every: 0, unit: 'day' })).toBeNull()
    expect(parseRecurrence({ every: 2, unit: 'fortnight' })).toBeNull()
    expect(parseRecurrence({ every: 2, unit: 'week' })).toEqual({
      every: 2, unit: 'week', until: null, paused: false,
    })
  })

  it('counts forward from the original due date so a cadence does not drift', () => {
    const next = nextOccurrence({ every: 2, unit: 'week' }, '2026-07-28T16:00:00.000Z', NOW)
    expect(next?.toISOString()).toBe('2026-08-11T16:00:00.000Z')
  })

  it('skips past occurrences rather than re-creating an already-overdue task', () => {
    const next = nextOccurrence({ every: 1, unit: 'week' }, '2026-05-01T16:00:00.000Z', NOW)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('stops on a paused cadence or once past its until date', () => {
    expect(nextOccurrence({ every: 1, unit: 'week', paused: true }, null, NOW)).toBeNull()
    expect(
      nextOccurrence({ every: 1, unit: 'month', until: '2026-08-01' }, '2026-07-28T16:00:00.000Z', NOW),
    ).toBeNull()
  })

  it('keeps running when until names a stage rather than a date', () => {
    expect(
      nextOccurrence({ every: 1, unit: 'week', until: 'funded' }, '2026-07-28T16:00:00.000Z', NOW),
    ).not.toBeNull()
  })
})

describe('quick capture parsing', () => {
  it('lifts a weekday and time out of the title', () => {
    const parsed = parseCapture('Call the Hendersons Fri 2pm', NOW)
    expect(parsed.title).toBe('Call the Hendersons')
    // 2pm on Friday 31 July in the firm's timezone (EDT, UTC-4).
    expect(parsed.dueAt?.toISOString()).toBe('2026-07-31T18:00:00.000Z')
  })

  it('reads tomorrow and in-N-days, defaulting to end of day', () => {
    expect(parseCapture('Send the draft tomorrow', NOW).dueAt?.toISOString())
      .toBe('2026-07-30T21:00:00.000Z')
    expect(parseCapture('Follow up in 3 days', NOW).title).toBe('Follow up')
    expect(parseCapture('Follow up in 3 days', NOW).dueAt?.toISOString())
      .toBe('2026-08-01T21:00:00.000Z')
  })

  it('reads an explicit month and day', () => {
    const parsed = parseCapture('File the deed Aug 14', NOW)
    expect(parsed.title).toBe('File the deed')
    expect(parsed.dueAt?.toISOString()).toBe('2026-08-14T21:00:00.000Z')
  })

  it('reads a bang priority and drops it from the title', () => {
    const parsed = parseCapture('Chase the signature !high', NOW)
    expect(parsed.priority).toBe('high')
    expect(parsed.title).toBe('Chase the signature')
  })

  it('reports the live @ and / tokens so the pickers can open', () => {
    expect(parseCapture('Call about the trust @hend', NOW).recordQuery).toBe('hend')
    expect(parseCapture('Kick off @', NOW).recordQuery).toBe('')
    expect(parseCapture('Apply /clos', NOW).templateQuery).toBe('clos')
    // A completed mention is no longer the live token.
    expect(parseCapture('Call @henderson now', NOW).recordQuery).toBeNull()
  })

  it('leaves text it cannot read in the title rather than guessing', () => {
    const parsed = parseCapture('Review the 401k rollover paperwork', NOW)
    expect(parsed.title).toBe('Review the 401k rollover paperwork')
    expect(parsed.dueAt).toBeNull()
  })
})
