import Link from 'next/link'
import { requireStaffPage } from '@/lib/review/staff'
import { fetchTaskCounts } from '@/lib/queries/tasks'
export async function TasksOverviewSection() {
  const { userId } = await requireStaffPage()
  const counts = await fetchTaskCounts(userId).catch(() => null)
  return <section className="space-y-3" aria-labelledby="overview-tasks"><h2 id="overview-tasks" className="text-xl font-semibold">Tasks</h2>
    {!counts ? <p role="alert">Task counts are unavailable. Please retry.</p> : <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Open', counts.open], ['Overdue', counts.overdue], ['Due today', counts.today], ['Unassigned', counts.unassigned]].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-2xl font-semibold">{value}</dd></div>)}</dl>}
    <Link href="/admin/tasks" className="text-sm underline">Open task workspace</Link>
  </section>
}
