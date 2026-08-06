import { createServerSupabase } from '@/lib/supabaseServer'
import { fetchTasks } from '@/lib/queries/tasks'
import { CrmActionQueue } from './CrmActionQueue'

export const dynamic = 'force-dynamic'

export default async function AdminCrmPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const tasks = await fetchTasks({ scope: 'mine', viewerId: user?.id ?? null, status: 'open', limit: 100 })
  return <CrmActionQueue tasks={tasks} />
}
