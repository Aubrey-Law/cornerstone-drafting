import Link from 'next/link'
import type { ActivityRow } from '@/lib/activities/feed'
import { formatDateTime } from '@/lib/utils'
import { activityLabel, activityTypeDetail } from '@/lib/activities/presentation'

/** The same bounded page of recorded events in desktop and narrow layouts. */
export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  return <>
    <ol className="divide-y divide-border rounded-xl border border-border bg-card md:hidden">
      {rows.map(row => <li key={row.id} className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{row.record_name ?? 'Unlinked'}</span><time dateTime={row.occurred_at}>{formatDateTime(row.occurred_at)}</time>
        </div>
        <Link href={row.href} className="block break-words text-sm font-medium hover:underline">{row.summary}</Link>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{row.actor_name ?? 'Actor not recorded'}</span>{activityTypeDetail(row) && <span>{activityTypeDetail(row)}</span>}{row.status && <span>{activityLabel(row.status)}</span>}</div>
      </li>)}
    </ol>
    <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
      <table className="w-full text-left text-sm"><caption className="sr-only">Recorded firm activity, newest first</caption>
        <thead className="bg-muted text-xs text-muted-foreground"><tr>{['When', 'Record', 'Activity', 'Actor', 'Status'].map(title => <th scope="col" className="px-4 py-3 font-medium" key={title}>{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{rows.map(row => <tr key={row.id} className="align-top hover:bg-accent">
          <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"><time dateTime={row.occurred_at}>{formatDateTime(row.occurred_at)}</time></td>
          <td className="px-4 py-3">{row.record_name ?? 'Unlinked'}</td>
          <td className="px-4 py-3"><Link href={row.href} className="font-medium hover:underline">{row.summary}</Link>{activityTypeDetail(row) && <p className="mt-1 text-xs text-muted-foreground">{activityTypeDetail(row)}</p>}</td>
          <td className="px-4 py-3 text-muted-foreground">{row.actor_name ?? 'Not recorded'}</td>
          <td className="px-4 py-3 text-xs text-muted-foreground">{row.status ? activityLabel(row.status) : '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </>
}
