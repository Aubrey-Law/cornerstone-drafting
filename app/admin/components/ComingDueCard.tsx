import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchUpcomingTasks } from '@/lib/slaTasks/queries'
import { firmTodayKey } from '@/lib/firmDate'
import { daysBetween } from '@/lib/slaTasks/schedule'
import { cn } from '@/lib/utils'

/**
 * "Coming due" — the next few SLA tasks across every matter. Renders nothing
 * when no matter has an SLA plan yet, so the dashboard stays quiet until the
 * feature is in use.
 */
export async function ComingDueCard({ limit = 5 }: { limit?: number }) {
  const today = firmTodayKey()

  let tasks
  try {
    tasks = await fetchUpcomingTasks(getAdminClient(), { days: 14, limit, today })
  } catch (e) {
    console.error('[coming-due] could not load upcoming tasks', e)
    return null
  }

  if (tasks.length === 0) return null

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Coming due</h2>
      </header>
      <ul className="divide-y divide-border">
        {tasks.map(task => {
          const inDays = daysBetween(today, task.due_date)
          const when = inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : `In ${inDays}d`
          return (
            <li key={task.id}>
              <Link
                href={`/admin/matters/${task.matter_id}?tab=tasks&view=plan`}
                className="block px-3 py-2 text-sm hover:bg-accent"
              >
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    inDays <= 1 ? 'text-amber-strong' : 'text-foreground',
                  )}
                >
                  {when}
                </span>
                <span className="text-foreground"> · {task.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {task.client_name ?? task.matter_name ?? 'Unnamed matter'}
                  {task.owner === 'client' && ' · waiting on client'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
