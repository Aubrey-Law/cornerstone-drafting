import Link from 'next/link'
import { Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { requireStaffPage } from '@/lib/review/staff'
import { FirmDashboard } from './FirmDashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Firm dashboard' }

const worklists = [
  ['/admin/tasks', 'Tasks', 'Assignments, deadlines, and blocked work'],
  ['/admin/drafting', 'Drafting', 'Design sheets and document generation'],
  ['/admin/review', 'Reviews', 'Matter reviews and unlinked uploads'],
  ['/admin/drafting/real-estate-transfer', 'Real estate transfers', 'Prepare transfer documents'],
  ['/admin/field-audits', 'Field audits', 'Check design-sheet consistency'],
  ['/admin/playbooks', 'Review playbooks', 'Manage review criteria'],
] as const

const sections = [
  ['firm-pulse', 'Pulse'],
  ['firm-attention', 'Attention'],
  ['firm-book', 'Book'],
  ['firm-closeout', 'Close-out'],
  ['overview-tools', 'Tools'],
] as const

export default async function OverviewPage() {
  const { userId } = await requireStaffPage()
  return <div className="space-y-6">
    <PageHeader
      title="Firm dashboard"
      description="Open matters, lead follow-up, task pressure, and close-out across the firm."
      actions={<Button asChild size="sm"><Link href="/admin">Open Today</Link></Button>}
    />
    <nav aria-label="Firm dashboard sections" className="flex gap-5 overflow-x-auto border-b border-border pb-3 text-sm">
      {sections.map(([id, label]) =>
        <a key={id} href={`#${id}`} className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{label}</a>)}
    </nav>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Suspense fallback={<p role="status">Loading the firm dashboard…</p>}>
        <FirmDashboard viewerId={userId} />
      </Suspense>
      <aside id="overview-tools" aria-label="Worklists" className="scroll-mt-20 rounded-xl border border-border bg-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worklists and tools</h2>
        <div className="mt-3 divide-y divide-border">
          {worklists.map(([href, title, description]) => <Link key={href} href={href} className="block rounded-md py-3 focus-visible:outline-2 focus-visible:outline-ring hover:bg-accent"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></Link>)}
        </div>
      </aside>
    </div>
  </div>
}
