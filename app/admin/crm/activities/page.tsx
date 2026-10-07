import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { requireStaffPage } from '@/lib/review/staff'
import { fetchFirmActivities } from '@/lib/queries/firmActivities'
import { activityFilters } from '@/lib/activities/feed'
import { formatDateTime } from '@/lib/utils'
import { ActivityFilters } from './ActivityFilters'

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
    <p className="text-xs text-muted-foreground">Dates use America/New_York. Generation and review entries show their recorded start time and current status.</p>
    {error ? <div role="alert" className="rounded border border-destructive p-4 text-sm">{error} <Link href="/admin/crm/activities" className="underline">Retry</Link></div> : rows.length === 0 ? <p className="rounded border border-dashed p-8 text-center">No recorded activity matches these filters.</p> : <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{['When', 'Record', 'Activity', 'Actor', 'Status'].map(title => <th className="p-3" key={title}>{title}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="whitespace-nowrap p-3">{formatDateTime(row.occurred_at)}</td><td className="p-3">{row.record_name ?? 'Unlinked'}</td><td className="p-3"><Link href={row.href} className="font-medium hover:underline">{row.summary}</Link><p className="text-xs text-muted-foreground">{row.event_type.replaceAll('_', ' ')}</p></td><td className="p-3">{row.actor_name ?? 'Not recorded'}</td><td className="p-3">{row.status ?? '—'}</td></tr>)}</tbody></table></div>}
    <nav aria-label="Activity pages" className="flex gap-4">{filters.cursor && <Link href={`/admin/crm/activities?${new URLSearchParams([...nextParams].filter(([key]) => key !== 'cursor'))}`} className="text-sm underline">Newest activity</Link>}{next && <Link href={`/admin/crm/activities?${nextParams}`} className="text-sm underline">Older activity</Link>}</nav>
  </div>
}
