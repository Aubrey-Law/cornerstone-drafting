import { TASK_SOURCES, type TaskPriority, type TaskSource } from '@/lib/tasks/types'
import { pageRequest, type PageRequest } from '@/lib/queries/page'
export type TaskPageGroup = 'priority' | 'due' | 'matter'
export const TASK_PAGE_GROUPS: readonly TaskPageGroup[] = ['priority', 'due', 'matter']
/** `group` is a filter, not just presentation: grouping by matter pages by
 *  whole matters, so one matter's tasks never straddle two pages. */
export type TaskPageFilters = { scope: 'mine' | 'team' | 'unassigned'; source: TaskSource | 'all'; priority: TaskPriority | 'all'; assignee: string; group: TaskPageGroup }
export type TaskPageParams = PageRequest & TaskPageFilters & { donePage: number; showDone: boolean }
export function taskPageParams(params: Record<string, string | string[] | undefined>): TaskPageParams {
  const scalar = (key: string) => typeof params[key] === 'string' ? params[key] as string : undefined
  const scope = scalar('scope') ?? 'mine'
  const source = scalar('source') ?? 'all'
  const priority = scalar('priority') ?? 'all'
  const assignee = scalar('assignee') ?? 'all'
  const group = scalar('group') ?? 'priority'
  if (!['mine','team','unassigned'].includes(scope) || !['all',...TASK_SOURCES].includes(source) || !['all','high','normal','low'].includes(priority) || !(TASK_PAGE_GROUPS as readonly string[]).includes(group)) throw new Error('Invalid task filter')
  if (assignee !== 'all' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignee)) throw new Error('Invalid assignee')
  return { ...pageRequest({ page: scalar('page'), pageSize: scalar('pageSize') }), scope: scope as TaskPageFilters['scope'], source: source as TaskSource | 'all', priority: priority as TaskPriority | 'all', assignee, group: group as TaskPageGroup, donePage: pageRequest({ page: scalar('donePage') }).page, showDone: scalar('done') === '1' }
}
