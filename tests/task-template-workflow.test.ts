import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeTemplateItems } from '@/lib/tasks/templateItems'

const templateSheet = readFileSync('components/tasks/TaskTemplateSheet.tsx', 'utf8')
const applyRoute = readFileSync('app/api/admin/task-templates/apply/route.ts', 'utf8')

describe('rich task templates', () => {
  it('normalizes every reusable task field and resets subtask completion', () => {
    expect(normalizeTemplateItems([{
      text: '  Review the deed  ',
      description: '  Confirm title and vesting  ',
      offset_days: 3.4,
      priority: 'high',
      assignee_id: '11111111-1111-4111-8111-111111111111',
      estimate_minutes: 45.2,
      recurrence: { every: 2, unit: 'week' },
      checklist: [
        { text: '  Pull registry copy ', done: true },
        { text: 'Confirm owner names', done: false },
        { text: ' ' },
      ],
    }])).toEqual([{
      text: 'Review the deed',
      description: 'Confirm title and vesting',
      offset_days: 3,
      priority: 'high',
      assignee_id: '11111111-1111-4111-8111-111111111111',
      estimate_minutes: 45,
      recurrence: { every: 2, unit: 'week', until: null, paused: false },
      checklist: [
        { text: 'Pull registry copy', done: false },
        { text: 'Confirm owner names', done: false },
      ],
    }])
  })

  it('falls back safely for malformed optional fields', () => {
    expect(normalizeTemplateItems([{
      text: 'Call client',
      priority: 'urgent',
      assignee_id: 'not-an-id',
      estimate_minutes: -2,
      recurrence: { every: 0, unit: 'day' },
    }])).toEqual([{
      text: 'Call client',
      description: null,
      offset_days: 0,
      priority: 'normal',
      assignee_id: null,
      estimate_minutes: null,
      recurrence: null,
      checklist: [],
    }])
  })

  it('provides create and edit controls for rich task fields', () => {
    expect(templateSheet).toContain("method: editing ? 'PATCH' : 'POST'")
    expect(templateSheet).toContain('Add subtask')
    expect(templateSheet).toContain('estimate_minutes')
    expect(templateSheet).toContain('assignee_id')
    expect(templateSheet).toContain('recurrence')
  })

  it('copies rich template fields into applied tasks', () => {
    expect(applyRoute).toContain('description: item.description')
    expect(applyRoute).toContain("task_type: item.checklist?.length ? 'checklist' : 'single'")
    expect(applyRoute).toContain('assignee_id: item.assignee_id ?? assigneeId')
    expect(applyRoute).toContain('estimate_minutes: item.estimate_minutes')
    expect(applyRoute).toContain('recurrence: item.recurrence')
  })
})
