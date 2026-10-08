import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { requireStaffPage } from '@/lib/review/staff'
import { fetchFirmActivities } from '@/lib/queries/firmActivities'
import { activityFilters } from '@/lib/activities/feed'
import { ActivityFeed } from './ActivityFeed'
import { Button } from '@/components/ui/button'
import { ActivityFilters } from './ActivityFilters'
import { AppliedActivityFilters } from './AppliedActivityFilters'

export const dynamic = 'force-dynamic'
export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage()
  const params = await searchParams
  let filters
  try { filters = activityFilters(params) } catch (error) {
    return <div className="space-y-4"><PageHeader title="Activities" /><p role="alert">{error instanceof Error ? error.message : 'Invalid filters'}</p><Link href="/admin/crm/activities">Reset filters</Link></div>
  }
  const { rows, next, error } = await fetchFirmActivities(filters)
  const nextParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (typeof value === 'string' && key !== 'cursor') nextParams.set(key, value)
  if (next) nextParams.set('cursor', next)
  return <div className="space-y-4">
    <PageHeader title="Activities" description="Recorded lead, matter, task, drafting, and review activity across the firm." />
    <ActivityFilters key={JSON.stringify(params)} filters={filters} />
    <AppliedActivityFilters filters={filters} />
    <p className="text-xs text-muted-foreground">Dates use America/New_York. Generation and review entries show their recorded start time and current status.</p>
    {error ? <div role="alert" className="rounded-xl border border-destructive/30 bg-red-bg p-4 text-sm text-destructive">{error} <Link href={`/admin/crm/activities?${new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}`} className="underline">Retry</Link></div>
      : <section aria-label="Recorded activity" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{filters.cursor ? 'Earlier activity' : 'Latest activity'}</h2><span className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? 'event' : 'events'} on this page</span></div>
        {rows.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center"><h3 className="font-medium">No activity found</h3><p className="mt-1 text-sm text-muted-foreground">No recorded activity matches these filters.</p><Link href="/admin/crm/activities" className="mt-3 inline-block text-sm underline">Clear filters</Link></div> : <ActivityFeed rows={rows} />}
      </section>}
    <nav aria-label="Activity pages" className="flex flex-wrap justify-between gap-3">{filters.cursor && <Button asChild variant="outline" size="sm"><Link href={`/admin/crm/activities?${new URLSearchParams([...nextParams].filter(([key]) => key !== 'cursor'))}`} className="text-sm underline">Newest activity</Link></Button>}{next && <Button asChild variant="outline" size="sm"><Link href={`/admin/crm/activities?${nextParams}`} className="text-sm underline">Older activity</Link></Button>}</nav>
  </div>
}
