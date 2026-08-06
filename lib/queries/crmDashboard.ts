import 'server-only'

import { buildCrmDashboard, type CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import { fetchCrmPeople, fetchCrmStages } from '@/lib/queries/cornerstoneCrm'
import { fetchTasks } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'

export interface CrmDashboardData {
  snapshot: CrmDashboardSnapshot
  tasks: TaskRow[]
  error: string | null
}

/**
 * Everything the CRM overview renders. A failed task read degrades to an empty
 * task list rather than taking the whole dashboard down with it.
 */
export async function fetchCrmDashboard(viewerId: string | null): Promise<CrmDashboardData> {
  const [peopleResult, stagesResult, tasks] = await Promise.all([
    fetchCrmPeople(500),
    fetchCrmStages(),
    fetchTasks({ scope: 'all', status: 'open', viewerId, limit: 5 }).catch(() => [] as TaskRow[]),
  ])

  return {
    snapshot: buildCrmDashboard({
      people: peopleResult.people,
      stages: stagesResult.stages,
    }),
    tasks,
    error: peopleResult.error ?? stagesResult.error,
  }
}
