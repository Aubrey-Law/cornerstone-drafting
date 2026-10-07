export const TASK_PRESENTATIONS = ['list', 'board', 'table'] as const
export type TaskPresentation = (typeof TASK_PRESENTATIONS)[number]
export function parseTaskPresentation(value: string | null | undefined): TaskPresentation {
  return value === 'board' || value === 'table' ? value : 'list'
}
export const TASK_BOARD_COLUMNS = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
] as const
