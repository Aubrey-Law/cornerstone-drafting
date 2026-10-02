import { describe, expect, it } from 'vitest'
import { isTaskAssigneeRole, TASK_ASSIGNEE_ROLES } from '@/lib/tasks/assignees'

describe('task assignee roles', () => {
  it('uses one role policy for every task assignment surface', () => {
    expect(TASK_ASSIGNEE_ROLES).toEqual(['attorney', 'admin', 'va', 'staff'])
    for (const role of TASK_ASSIGNEE_ROLES) expect(isTaskAssigneeRole(role)).toBe(true)
  })

  it('does not allow client or unknown profiles to receive task work', () => {
    expect(isTaskAssigneeRole('client')).toBe(false)
    expect(isTaskAssigneeRole('owner')).toBe(false)
    expect(isTaskAssigneeRole(null)).toBe(false)
  })
})
