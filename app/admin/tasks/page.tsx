import { createServerSupabase } from '@/lib/supabaseServer'
import { fetchTaskAssignees, fetchTasks, fetchTaskTemplates } from '@/lib/queries/tasks'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { TasksClient } from './TasksClient'

export const dynamic = 'force-dynamic'

export default async function AdminTasksPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const [openTasks, doneTasks, assignees, templates] = await Promise.all([
    fetchTasks({ status: 'open', limit: 500 }),
    fetchTasks({ status: 'done', limit: 200 }),
    fetchTaskAssignees(),
    fetchTaskTemplates(),
  ])

  // The Done group only shows what was cleared today — anything older is history.
  const todayKey = firmTodayKey()
  const doneToday = doneTasks.filter(task => task.completed_at && firmDateKey(task.completed_at) === todayKey)

  return (
    <TasksClient
      initialOpenTasks={openTasks}
      initialDoneToday={doneToday}
      assignees={assignees}
      templates={templates}
      viewerId={user?.id ?? null}
    />
  )
}
