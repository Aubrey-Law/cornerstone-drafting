import { createServerSupabase } from '@/lib/supabaseServer'
import { fetchTasks } from '@/lib/queries/tasks'
import { fetchCrmOperations } from '@/lib/queries/crmOperations'
import { CrmActionQueue } from './CrmActionQueue'

export const dynamic = 'force-dynamic'

const VIEWS = ['mine', 'team', 'unassigned', 'overdue', 'due-today', 'leads', 'clients'] as const
type CrmView = (typeof VIEWS)[number]

export default async function AdminCrmPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const requestedView = (await searchParams).view
  const view: CrmView = VIEWS.includes(requestedView as CrmView) ? requestedView as CrmView : 'mine'
  const scope = view === 'team' ? 'team' : view === 'unassigned' ? 'unassigned' : 'mine'
  const [tasks, operations] = await Promise.all([
    fetchTasks({ scope, viewerId: user?.id ?? null, status: 'open', limit: 200 }),
    fetchCrmOperations(),
  ])
  return <CrmActionQueue tasks={tasks} operations={operations} view={view} />
}
