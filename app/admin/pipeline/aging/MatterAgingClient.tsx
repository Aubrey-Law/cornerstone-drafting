'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PauseCircle, RefreshCw, Search } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import type { MatterAgingRow, MatterAgingTiles } from '@/lib/queries/pipelineAging'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type HealthFilter = 'all' | 'red' | 'amber' | 'green' | 'overdue' | 'snoozed'

const HEALTH_DOT: Record<string, string> = {
  red: 'bg-red-strong',
  amber: 'bg-amber-orange',
  green: 'bg-green',
}

const HEALTH_BADGE: Record<string, string> = {
  red: 'border-red-strong-border bg-red-strong-bg text-red-strong',
  amber: 'border-amber-border bg-amber-bg text-amber',
  green: 'border-green/40 bg-green-bg text-green',
}

function SummaryTile({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  accent?: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border bg-card px-4 py-3 text-left transition-colors',
        active ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:bg-muted/40',
      )}
    >
      <div className="text-2xl font-semibold tabular-nums" style={{ color: accent ?? 'var(--primary)' }}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </button>
  )
}

function SlaProgress({ row }: { row: MatterAgingRow }) {
  if (row.is_snoozed) {
    return (
      <div className="space-y-1">
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Snoozed until {row.snoozed_until ? formatDate(row.snoozed_until) : '—'}
        </Badge>
        {row.snooze_reason && (
          <p className="max-w-[140px] truncate text-[10px] text-muted-foreground">{row.snooze_reason}</p>
        )}
      </div>
    )
  }

  if (row.sla_days === null) {
    return <span className="text-xs text-muted-foreground">{row.days_in_stage}d (no SLA)</span>
  }

  const pct = Math.min((row.days_in_stage / row.sla_days) * 100, 100)
  const barColor =
    row.health === 'red' ? 'bg-red-strong' : row.health === 'amber' ? 'bg-amber-orange' : 'bg-green'

  return (
    <div className="space-y-1">
      <span
        className={cn(
          'text-xs tabular-nums',
          row.is_overdue ? 'font-semibold text-red-strong' : 'text-foreground',
        )}
      >
        {row.days_in_stage}/{row.sla_days}d
        {row.days_over_sla != null && row.days_over_sla > 0 ? ` (+${row.days_over_sla})` : ''}
      </span>
      <div className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function SnoozeDialog({
  row,
  open,
  onOpenChange,
  onSaved,
  token,
}: {
  row: MatterAgingRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  token: string | null
}) {
  const [days, setDays] = useState('3')
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      setDays('3')
      setReason('')
    }
  }, [open, row?.id])

  if (!row) return null

  const target = row

  async function save() {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    const n = Number(days)
    if (!Number.isFinite(n) || n < 1) {
      toast.error('Enter a valid number of days')
      return
    }
    const until = new Date()
    until.setDate(until.getDate() + n)

    startTransition(async () => {
      const res = await fetch('/api/admin/pipeline/aging/snooze', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entity: 'matter',
          entity_id: target.id,
          stage_key: target.current_stage,
          snoozed_until: until.toISOString(),
          reason: reason.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Snooze failed')
        return
      }
      toast.success(`Snoozed until ${formatDate(until.toISOString())}`)
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Snooze aging alert</DialogTitle>
          <DialogDescription>
            Hide {target.client_name ?? 'this matter'} from action queues until the snooze expires.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="snooze-days">Snooze for (calendar days)</Label>
            <div className="flex gap-2">
              {['3', '7', '14'].map(d => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={days === d ? 'default' : 'outline'}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
              <Input
                id="snooze-days"
                type="number"
                min={1}
                className="h-8 w-20"
                value={days}
                onChange={e => setDays(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="snooze-reason">Reason (optional)</Label>
            <Textarea
              id="snooze-reason"
              placeholder="Client on vacation, waiting on documents…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={pending}>
            Snooze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface MatterAgingClientProps {
  initialRows: MatterAgingRow[]
  initialTiles: MatterAgingTiles
}

export default function MatterAgingClient({ initialRows, initialTiles }: MatterAgingClientProps) {
  const token = useAccessToken()
  const [rows, setRows] = useState(initialRows)
  const [tiles, setTiles] = useState(initialTiles)
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [snoozeRow, setSnoozeRow] = useState<MatterAgingRow | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/pipeline/aging', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        toast.error('Could not refresh aging data')
        return
      }
      const body = await res.json()
      setRows(body.rows ?? [])
      setTiles(body.tiles ?? initialTiles)
    } finally {
      setRefreshing(false)
    }
  }, [token, initialTiles])

  const unsnooze = async (row: MatterAgingRow) => {
    if (!token || !row.snooze_id) return
    const res = await fetch('/api/admin/pipeline/aging/snooze', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snooze_id: row.snooze_id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Could not unsnooze')
      return
    }
    toast.success('Snooze cleared')
    await refresh()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (healthFilter === 'red' && (r.health !== 'red' || r.is_snoozed)) return false
      if (healthFilter === 'amber' && (r.health !== 'amber' || r.is_snoozed)) return false
      if (healthFilter === 'green' && (r.health !== 'green' || r.is_snoozed)) return false
      if (healthFilter === 'overdue' && (!r.is_overdue || r.is_snoozed)) return false
      if (healthFilter === 'snoozed' && !r.is_snoozed) return false
      if (!q) return true
      const hay = [r.client_name, r.client_email, r.current_stage, r.owner]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, healthFilter, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matter aging</h1>
          <p className="text-sm text-muted-foreground">
            Business-day SLA health for active matters. Snoozed items are excluded from counts.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={refreshing || !token}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryTile
          label="Active"
          value={tiles.active}
          active={healthFilter === 'all'}
          onClick={() => setHealthFilter('all')}
        />
        <SummaryTile
          label="Red"
          value={tiles.red}
          accent="var(--red-strong)"
          active={healthFilter === 'red'}
          onClick={() => setHealthFilter('red')}
        />
        <SummaryTile
          label="Amber"
          value={tiles.amber}
          accent="var(--amber-orange)"
          active={healthFilter === 'amber'}
          onClick={() => setHealthFilter('amber')}
        />
        <SummaryTile
          label="Green"
          value={tiles.green}
          accent="var(--green)"
          active={healthFilter === 'green'}
          onClick={() => setHealthFilter('green')}
        />
        <SummaryTile
          label="Overdue"
          value={tiles.overdue}
          accent="var(--red-strong)"
          active={healthFilter === 'overdue'}
          onClick={() => setHealthFilter('overdue')}
        />
        <SummaryTile
          label="Snoozed"
          value={tiles.snoozed}
          active={healthFilter === 'snoozed'}
          onClick={() => setHealthFilter('snoozed')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-strong" />
          Overdue or needs outreach
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-orange" />
          Due within 1 business day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-green" />
          On track
        </span>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search matters…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No matters match your filters.</p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Days in stage</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Entered</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(row => (
                <TableRow key={row.id} className={row.is_snoozed ? 'opacity-70' : undefined}>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-block h-2.5 w-2.5 rounded-full',
                        row.is_snoozed ? 'bg-muted-foreground/40' : HEALTH_DOT[row.health],
                      )}
                      title={row.health}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/admin/matters/${row.id}`} className="hover:underline">
                      {row.client_name ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell>{engineStageLabel(row.current_stage)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.owner === 'attorney' ? 'Attorney' : 'Client'}
                  </TableCell>
                  <TableCell>
                    <SlaProgress row={row} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('text-[10px] capitalize', HEALTH_BADGE[row.health])}>
                      {row.is_snoozed ? 'snoozed' : row.health}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.stage_entered_at)}</TableCell>
                  <TableCell>
                    {row.is_snoozed ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void unsnooze(row)}>
                        <PauseCircle className="mr-1 h-3.5 w-3.5" />
                        Unsnooze
                      </Button>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSnoozeRow(row)}>
                        <PauseCircle className="mr-1 h-3.5 w-3.5" />
                        Snooze
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SnoozeDialog
        row={snoozeRow}
        open={Boolean(snoozeRow)}
        onOpenChange={open => {
          if (!open) setSnoozeRow(null)
        }}
        onSaved={() => void refresh()}
        token={token}
      />
    </div>
  )
}
