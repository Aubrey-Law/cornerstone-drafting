import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detailSheet = readFileSync('components/tasks/TaskDetailSheet.tsx', 'utf8')
const taskRoute = readFileSync('app/api/admin/tasks/[id]/route.ts', 'utf8')
const taskPage = readFileSync('app/admin/tasks/TasksClient.tsx', 'utf8')
const recordTab = readFileSync('components/tasks/RecordTasksTab.tsx', 'utf8')
const railPane = readFileSync('components/rail/RailTasksPane.tsx', 'utf8')

describe('task detail workflow', () => {
  it('exposes the persisted task fields through one reusable detail sheet', () => {
    expect(detailSheet).toContain('Task details')
    expect(detailSheet).toContain('setStatus')
    expect(detailSheet).toContain('setPriority')
    expect(detailSheet).toContain('setAssigneeId')
    expect(detailSheet).toContain('estimate_minutes')
    expect(detailSheet).toContain('recurrence')
    expect(detailSheet).toContain('checklist: subtasks')
  })

  it('supports post-save subtask replacement and derives checklist task type', () => {
    expect(taskRoute).toContain('if (body.checklist !== undefined)')
    expect(taskRoute).toContain("patch.task_type = checklist.length > 0 ? 'checklist' : 'single'")
    // A checklist still decides the status — but only when the request did not
    // say outright, and only when there are items to decide from. What each
    // branch writes is exercised in tests/task-completion-persists.test.ts.
    expect(taskRoute).toContain("Object.assign(patch, statusStamps('done', existing, auth.userId))")
    expect(taskRoute).toContain("Object.assign(patch, statusStamps('open', existing, auth.userId))")
    expect(taskRoute).toContain('if (!statusRequested && checklist.length > 0)')
  })

  it('requires confirmation before invoking the existing delete action', () => {
    expect(detailSheet).toContain('<AlertDialog')
    expect(detailSheet).toContain('Delete this task?')
    expect(detailSheet).toContain('actions.remove(currentTask)')
  })

  it('connects the detail sheet to every ordinary task surface', () => {
    expect(taskPage).toContain('<TaskDetailSheet')
    expect(recordTab).toContain('<TaskDetailSheet')
    expect(railPane).toContain('<TaskDetailSheet')
  })
})
