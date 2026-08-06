'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Activity, Search } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { SearchField } from '@/components/SearchField'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import type { CrmActivityListRow } from '@/lib/queries/crmHub'

export function ActivitiesClient({ rows }: { rows: CrmActivityListRow[] }) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [personId, setPersonId] = useState('all')
  const [opportunityId, setOpportunityId] = useState('all')
  const [channel, setChannel] = useState('all')
  const [actorId, setActorId] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const types = useMemo(() => [...new Set(rows.map(row => row.type))].sort(), [rows])
  const channels = useMemo(() => [...new Set(rows.map(row => row.channel).filter((value): value is string => Boolean(value)))].sort(), [rows])
  const people = useMemo(() => [...new Map(rows.filter(row => row.personId && row.personName).map(row => [row.personId!, row.personName!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])
  const opportunities = useMemo(() => [...new Map(rows.filter(row => row.opportunityId && row.opportunityName).map(row => [row.opportunityId!, row.opportunityName!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])
  const actors = useMemo(() => [...new Map(rows.filter(row => row.actorId && row.actorName).map(row => [row.actorId!, row.actorName!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter(row => {
      if (type !== 'all' && row.type !== type) return false
      if (personId !== 'all' && row.personId !== personId) return false
      if (opportunityId !== 'all' && row.opportunityId !== opportunityId) return false
      if (channel !== 'all' && row.channel !== channel) return false
      if (actorId !== 'all' && row.actorId !== actorId) return false
      const activityDate = row.createdAt.slice(0, 10)
      if (dateFrom && activityDate < dateFrom) return false
      if (dateTo && activityDate > dateTo) return false
      if (!needle) return true
      return [row.personName, row.opportunityName, row.actorName, row.subject, row.body, row.eventType, row.channel, row.source]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(needle))
    })
  }, [rows, search, type, personId, opportunityId, channel, actorId, dateFrom, dateTo])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activities"
        eyebrow="CRM timeline"
        icon={Activity}
        description="Calls, messages, meetings, notes, tasks, campaign touches, and pipeline changes across the firm."
      />
      <div className="flex flex-wrap gap-2">
        <SearchField value={search} onValueChange={setSearch} placeholder="Search activities…" aria-label="Search CRM activities" containerClassName="w-full sm:w-80" />
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={type} onChange={event => setType(event.target.value)} aria-label="Filter activity type">
          <option value="all">All types</option>
          {types.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={personId} onChange={event => setPersonId(event.target.value)} aria-label="Filter by person">
          <option value="all">All people</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={opportunityId} onChange={event => setOpportunityId(event.target.value)} aria-label="Filter by opportunity">
          <option value="all">All opportunities</option>
          {opportunities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={channel} onChange={event => setChannel(event.target.value)} aria-label="Filter by channel">
          <option value="all">All channels</option>
          {channels.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={actorId} onChange={event => setActorId(event.target.value)} aria-label="Filter by actor">
          <option value="all">All actors</option>
          {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">From<input className="bg-transparent text-sm text-foreground" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
        <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">To<input className="bg-transparent text-sm text-foreground" type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={Search} title="No activities match" description={rows.length ? 'Try a different search or type.' : 'CRM activities will appear as staff works with people and opportunities.'} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Person</TableHead><TableHead>Opportunity</TableHead><TableHead>Activity</TableHead><TableHead>Channel</TableHead><TableHead>Direction</TableHead></TableRow></TableHeader>
            <TableBody>
              {visible.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>{row.personName ?? '—'}</TableCell>
                  <TableCell>{row.opportunityId ? <Link className="hover:underline" href={`/admin/crm/opportunities/${row.opportunityId}`}>{row.opportunityName ?? 'Open'}</Link> : '—'}</TableCell>
                  <TableCell><p className="font-medium">{row.subject ?? row.eventType ?? row.type}</p>{row.body ? <p className="max-w-md truncate text-xs text-muted-foreground">{row.body}</p> : null}{row.actorName ? <p className="text-xs text-muted-foreground">By {row.actorName}</p> : null}</TableCell>
                  <TableCell><Badge variant="secondary">{row.channel ?? row.type}</Badge></TableCell>
                  <TableCell className="capitalize text-muted-foreground">{row.direction}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing {visible.length} of {rows.length} activities.</p>
    </div>
  )
}
