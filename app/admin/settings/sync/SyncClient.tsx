'use client'

import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { FilterChip } from '@/components/FilterChip'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import type { CrmSyncEventRow } from '@/lib/queries/crmHub'

const STATUSES = ['all', 'held', 'ready', 'processing', 'completed', 'failed'] as const

export function SyncClient({ rows }: { rows: CrmSyncEventRow[] }) {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const counts = useMemo(() => Object.fromEntries(STATUSES.map(value => [value, value === 'all' ? rows.length : rows.filter(row => row.status === value).length])) as Record<(typeof STATUSES)[number], number>, [rows])
  const visible = status === 'all' ? rows : rows.filter(row => row.status === status)
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sync"
        eyebrow="Provider-neutral outbox"
        icon={RefreshCw}
        description="Durable CRM events are held here until an external connector is configured. Held events are expected and are not failures."
      />
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(value => <FilterChip key={value} selected={status === value} count={counts[value]} onClick={() => setStatus(value)}>{value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1)}</FilterChip>)}
      </div>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Event</TableHead><TableHead>Entity</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
          <TableBody>
            {visible.map(row => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell className="font-medium">{row.eventName ?? 'CRM event'}</TableCell>
                <TableCell><span className="capitalize">{row.entityType.replaceAll('_', ' ')}</span><p className="max-w-36 truncate text-xs text-muted-foreground">{row.entityId}</p></TableCell>
                <TableCell>{row.provider ?? 'Not configured'}</TableCell>
                <TableCell><Badge variant={row.status === 'failed' ? 'destructive' : 'secondary'}>{row.status}</Badge></TableCell>
                <TableCell>{row.attemptCount}</TableCell>
                <TableCell className="max-w-52 truncate text-xs text-destructive">{row.errorMessage ?? '—'}</TableCell>
              </TableRow>
            ))}
            {!visible.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No sync events match this status.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Showing {visible.length} of {rows.length} outbox events.</p>
    </div>
  )
}
