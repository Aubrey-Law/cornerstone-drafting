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
  onOpen: (matterId: string) => void
}

export default function MatterPipelineTable({
  matters,
  focusedIndex,
  onOpen,
}: MatterPipelineTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
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
