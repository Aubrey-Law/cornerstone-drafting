import Link from 'next/link'
import { requireStaffPage } from '@/lib/review/staff'
import { fetchTaskCounts } from '@/lib/queries/tasks'

export async function TasksOverviewSection() {
  const { userId } = await requireStaffPage()
  const counts = await fetchTaskCounts(userId).catch(() => null)
  const tiles = counts
    ? ([['Open', counts.open], ['Overdue', counts.overdue], ['Due today', counts.today], ['Unassigned', counts.unassigned]] as const)
        .filter(([, value]) => value > 0)
    : null

  return (
    <section className="space-y-3" aria-labelledby="overview-tasks">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="overview-tasks" className="scroll-mt-20 text-lg font-semibold">Tasks</h2>
          <p className="text-sm text-muted-foreground">Open assignments and work that needs attention.</p>
        </div>
        <Link href="/admin/tasks" className="shrink-0 text-sm font-medium hover:underline">View tasks</Link>
      </div>
      {!counts ? (
        <p role="alert">Task counts are unavailable. Please retry.</p>
      ) : tiles && tiles.length > 0 ? (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No open task pressure right now.</p>
      )}
    </section>
  )
}
