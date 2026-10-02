export const TASK_ASSIGNEE_ROLES = ['attorney', 'admin', 'va', 'staff'] as const

export function isTaskAssigneeRole(role: unknown): role is (typeof TASK_ASSIGNEE_ROLES)[number] {
  return typeof role === 'string' && TASK_ASSIGNEE_ROLES.includes(role as (typeof TASK_ASSIGNEE_ROLES)[number])
}
