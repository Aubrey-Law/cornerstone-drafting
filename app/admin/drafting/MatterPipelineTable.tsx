'use client'

import { ChevronRight } from 'lucide-react'
import { useDebouncedPrefetch } from '@/lib/useDebouncedPrefetch'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatDate } from '@/lib/utils'
import { hubLastActivityAt, hubNextAction } from '@/lib/drafting/hubUtils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'

interface MatterPipelineTableProps {
  matters: DraftingHubMatter[]
  focusedIndex: number
  onFocusIndex: (index: number) => void
  onOpen: (matterId: string) => void
}

export default function MatterPipelineTable({
  matters,
  focusedIndex,
  onFocusIndex,
  onOpen,
}: MatterPipelineTableProps) {
  return (
    <>
      <div className="space-y-2 md:hidden" role="list" aria-label="Drafting matters">
        {matters.map((item, index) => (
          <MatterPipelineCard
            key={item.matter.matter_id}
            item={item}
            index={index}
            focusedIndex={focusedIndex}
            onFocusIndex={onFocusIndex}
            onOpen={onOpen}
          />
        ))}
      </div>

      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table aria-label="Drafting matters table">
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Matter</TableHead>
              <TableHead>Next action</TableHead>
              <TableHead className="text-right">Docs</TableHead>
              <TableHead className="text-right">Drafts</TableHead>
              <TableHead>Last drafting activity</TableHead>
              <TableHead>Practice</TableHead>
              <TableHead className="w-10" aria-label="Open drafting" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {matters.map((item, index) => (
              <MatterPipelineTableRow
                key={item.matter.matter_id}
                item={item}
                index={index}
                focusedIndex={focusedIndex}
                onOpen={onOpen}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function MatterPipelineCard({
  item,
  index,
  focusedIndex,
  onFocusIndex,
  onOpen,
}: {
  item: DraftingHubMatter
  index: number
  focusedIndex: number
  onFocusIndex: (index: number) => void
  onOpen: (matterId: string) => void
}) {
  const matter = item.matter
  const action = hubNextAction(item)
  const lastActivity = hubLastActivityAt(item)
  const focused = index === focusedIndex
  const { schedulePrefetch, cancelPrefetch } = useDebouncedPrefetch(`/admin/drafting/${matter.matter_id}`)
  const matterLabel = [item.matterNumber, matter.matter_name || matter.plan_type].filter(Boolean).join(' · ') || '—'

  return (
    <div role="listitem">
      <button
        type="button"
        data-drafting-card-index={index}
        data-state={focused ? 'selected' : undefined}
        className="w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:border-primary/40 data-[state=selected]:bg-muted/50"
        onClick={() => onOpen(matter.matter_id)}
        onMouseEnter={schedulePrefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={() => {
          onFocusIndex(index)
          schedulePrefetch()
        }}
        onBlur={cancelPrefetch}
      >
        <span className="sr-only">Open drafting: </span>
        <span className="flex min-w-0 items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">
              {matter.client_name || 'Unnamed client'}
            </span>
            {matter.spouse_name && (
              <span className="block truncate text-xs text-muted-foreground">
                & {matter.spouse_name}
              </span>
            )}
            <span className="mt-1 block truncate text-xs text-muted-foreground">{matterLabel}</span>
          </span>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </span>

        <span className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
          <span className="min-w-0">
            <Badge
              className={cn(
                'border-0 text-[10px]',
                action.tone === 'success' && 'bg-success/10 text-success',
                action.tone === 'info' && 'bg-blue-bg text-blue',
                action.tone === 'warning' && 'bg-warning/10 text-warning',
              )}
            >
              {action.label}
            </Badge>
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">{action.detail}</span>
          </span>
        </span>

        <span className="mt-3 grid grid-cols-4 gap-2 border-t border-border/70 pt-3">
          <CardMetric label="Documents" value={String(item.includedDocumentLabels.length)} dataValue="documents" />
          <CardMetric label="Drafts" value={String(item.draftCount)} dataValue="drafts" />
          <CardMetric label="Activity" value={lastActivity ? formatDate(lastActivity) : '—'} />
          <CardMetric label="Practice" value={matter.practice_area || '—'} />
        </span>
      </button>
    </div>
  )
}

function CardMetric({ label, value, dataValue }: { label: string; value: string; dataValue?: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium tabular-nums text-foreground" data-value={dataValue}>
        {value}
      </span>
    </span>
  )
}

function MatterPipelineTableRow({
  item,
  index,
  focusedIndex,
  onOpen,
}: {
  item: DraftingHubMatter
  index: number
  focusedIndex: number
  onOpen: (matterId: string) => void
}) {
  const matter = item.matter
  const action = hubNextAction(item)
  const lastActivity = hubLastActivityAt(item)
  const focused = index === focusedIndex
  const { schedulePrefetch, cancelPrefetch } = useDebouncedPrefetch(`/admin/drafting/${matter.matter_id}`)

  return (
    <TableRow
      data-state={focused ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={() => onOpen(matter.matter_id)}
      onMouseEnter={schedulePrefetch}
      onMouseLeave={cancelPrefetch}
    >
      <TableCell className="max-w-[12rem] font-medium">
        <span className="block truncate">{matter.client_name || 'Unnamed client'}</span>
        {matter.spouse_name && (
          <span className="block truncate text-[11px] font-normal text-muted-foreground">
            & {matter.spouse_name}
          </span>
        )}
      </TableCell>
      <TableCell className="max-w-[10rem]">
        <span className="block truncate text-muted-foreground">
          {[item.matterNumber, matter.matter_name || matter.plan_type].filter(Boolean).join(' · ') || '—'}
        </span>
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <Badge
            className={cn(
              'border-0 text-[10px]',
              action.tone === 'success' && 'bg-success/10 text-success',
              action.tone === 'info' && 'bg-blue-bg text-blue',
              action.tone === 'warning' && 'bg-warning/10 text-warning',
            )}
          >
            {action.label}
          </Badge>
          <span className="block text-[11px] text-muted-foreground">{action.detail}</span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{item.includedDocumentLabels.length}</TableCell>
      <TableCell className="text-right tabular-nums">{item.draftCount}</TableCell>
      <TableCell className="text-muted-foreground">
        {lastActivity ? formatDate(lastActivity) : '—'}
      </TableCell>
      <TableCell className="max-w-[8rem] truncate text-muted-foreground">
        {matter.practice_area || '—'}
      </TableCell>
      <TableCell className="text-right">
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </TableCell>
    </TableRow>
  )
}
