import Link from 'next/link'
import { Suspense } from 'react'
import { Button } from '@/components/ui/button'
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
  return <div className="space-y-6">
    <PageHeader title="Overview" description="Firm-wide workload, follow-up, and matters approaching completion."
      actions={<Button asChild size="sm"><Link href="/admin">Open Today</Link></Button>} />
    <nav aria-label="Overview sections" className="flex gap-5 overflow-x-auto border-b border-border pb-3 text-sm">
      {[['tasks', 'Tasks'], ['matters', 'Matters'], ['leads', 'Leads'], ['tools', 'Tools']].map(([id, label]) =>
        <a key={id} href={`#overview-${id}`} className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{label}</a>)}
    </nav>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-8">
        <Suspense fallback={<p role="status">Loading tasks…</p>}><TasksOverviewSection /></Suspense>
        <Suspense fallback={<p role="status">Loading matters…</p>}><MattersOverviewSection /></Suspense>
        <Suspense fallback={<p role="status">Loading leads…</p>}><LeadsOverviewSection /></Suspense>
      </div>
      <aside id="overview-tools" aria-label="Worklists" className="scroll-mt-20 rounded-xl border border-border bg-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worklists and tools</h2>
        <div className="mt-3 divide-y divide-border">
          {worklists.map(([href, title, description]) => <Link key={href} href={href} className="block rounded-md py-3 focus-visible:outline-2 focus-visible:outline-ring hover:bg-accent"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></Link>)}
        </div>
      </aside>
    </div>
  </div>
}
