import Link from 'next/link'
import { X } from 'lucide-react'
import type { ActivityFilters } from '@/lib/activities/feed'
import { activityLabel } from '@/lib/activities/presentation'

const filterNames = {
  source: 'Source', event: 'Event', from: 'From', to: 'Through',
  record: 'Record', person: 'Person', actor: 'Actor',
} as const

export function AppliedActivityFilters({ filters }: { filters: ActivityFilters }) {
  const active = (Object.keys(filterNames) as Array<keyof typeof filterNames>).filter(key => filters[key])
  if (!active.length) return null
  return <nav aria-label="Applied activity filters" className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-muted-foreground">Filtered by</span>
    {active.map(key => {
      const params = new URLSearchParams()
      for (const other of active) if (other !== key) params.set(other, filters[other])
      const value = ['record', 'person', 'actor'].includes(key) ? 'Selected' : key === 'source' && filters[key] === 'crm' ? 'CRM' : activityLabel(filters[key])
      return <Link key={key} href={`/admin/crm/activities?${params}`} aria-label={`Remove ${filterNames[key].toLowerCase()} filter`} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {filterNames[key]}: {value}<X className="size-3" aria-hidden />
      </Link>
    })}
  </nav>
}
