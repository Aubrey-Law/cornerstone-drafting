export const TASK_PRESENTATIONS = ['list', 'board', 'table'] as const
export type TaskPresentation = (typeof TASK_PRESENTATIONS)[number]
/** The URL's `?presentation=` wins; otherwise the surface's own default. */
export function parseTaskPresentation(value: string | null | undefined, fallback: TaskPresentation = 'list'): TaskPresentation {
  return value === 'list' || value === 'board' || value === 'table' ? value : fallback
}
export const TASK_BOARD_COLUMNS = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
] as const
