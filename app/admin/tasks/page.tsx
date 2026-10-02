import { redirect } from 'next/navigation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchTaskAssignees, fetchTaskPage, fetchTaskTemplates } from '@/lib/queries/tasks'
import { firmTodayKey } from '@/lib/firmDate'
import { taskPageParams } from '@/lib/tasks/pageParams'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { buildTaskWorkSummaries } from '@/lib/work/taskSummary'
import { TasksClient } from './TasksClient'

export const dynamic = 'force-dynamic'
export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')
  const params = taskPageParams(await searchParams)
  const query = { ...params, viewerId: user.id }
  const [open, done, assignees, templates, workGraph] = await Promise.all([
    fetchTaskPage({ ...query, status: 'open' }),
    params.showDone ? fetchTaskPage({ ...query, page: params.donePage, status: 'done', completedOn: firmTodayKey() }) : null,
    fetchTaskAssignees(), fetchTaskTemplates(), fetchWorkGraphForUser(user.id),
  ])
  const allWorkSummaries = buildTaskWorkSummaries(workGraph.items)
  const workSummaries = Object.fromEntries(open.rows.flatMap(task => {
    const summary = allWorkSummaries[task.id]
    return summary ? [[task.id, summary] as const] : []
  }))
  return <TasksClient initialOpenTasks={open.rows} initialDoneToday={done?.rows ?? []}
    assignees={assignees} templates={templates} viewerId={user.id}
    workSummaries={workSummaries}
    pagination={{ params: { ...params, page: open.page, donePage: done?.page ?? params.donePage }, total: open.total, pageCount: open.pageCount, doneTotal: done?.total ?? 0, scopeCounts: open.scopeCounts }} />
}
