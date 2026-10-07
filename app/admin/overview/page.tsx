import Link from 'next/link'
import { Suspense } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { requireStaffPage } from '@/lib/review/staff'
import { TasksOverviewSection } from './TasksOverviewSection'
import { LeadsOverviewSection } from './LeadsOverviewSection'
import { MattersOverviewSection } from './MattersOverviewSection'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Overview' }
const worklists = [
  ['/admin/tasks', 'Tasks', 'Assignments, deadlines, and blocked work'],
  ['/admin/drafting', 'Drafting', 'Design sheets and document generation'],
  ['/admin/review', 'Reviews', 'Matter reviews and unlinked uploads'],
  ['/admin/drafting/real-estate-transfer', 'Real estate transfers', 'Prepare transfer documents'],
  ['/admin/field-audits', 'Field audits', 'Check design-sheet consistency'],
  ['/admin/playbooks', 'Review playbooks', 'Manage review criteria'],
] as const
export default async function OverviewPage() {
  await requireStaffPage()
  return <div className="space-y-8">
    <PageHeader title="Overview" description="The firm's leads, matters, and work. Open Today for your next action." />
    <section aria-label="Worklists" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {worklists.map(([href, title, description]) => <Link key={href} href={href} className="rounded-lg border bg-card p-4 hover:bg-accent"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></Link>)}
    </section>
    <Suspense fallback={<p role="status">Loading tasks…</p>}><TasksOverviewSection /></Suspense>
    <Suspense fallback={<p role="status">Loading leads…</p>}><LeadsOverviewSection /></Suspense>
    <Suspense fallback={<p role="status">Loading matters…</p>}><MattersOverviewSection /></Suspense>
  </div>
}
