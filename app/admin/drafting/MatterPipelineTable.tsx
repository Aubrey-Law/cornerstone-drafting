'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
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
import { hubLastActivityAt, hubReadinessLabel } from '@/lib/drafting/hubUtils'
import { updateMatterStage } from '@/lib/drafting/updateMatterStage'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import { STAGES, stageLabel, type MatterStage } from '@/types/database'

interface MatterPipelineTableProps {
  matters: DraftingHubMatter[]
  focusedIndex: number
  onOpen: (matterId: string) => void
  onStageChange: (matterId: string, stage: MatterStage) => void
}

export default function MatterPipelineTable({
  matters,
  focusedIndex,
  onOpen,
  onStageChange,
}: MatterPipelineTableProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleStageSelect = useCallback(async (item: DraftingHubMatter, nextStage: MatterStage) => {
    const matterId = item.matter.matter_id
    if (item.matter.stage === nextStage) return

    setError(null)
    setUpdatingId(matterId)
    onStageChange(matterId, nextStage)

    const result = await updateMatterStage(matterId, nextStage)
    setUpdatingId(null)

    if (!result.ok) {
      setError(result.error)
      onStageChange(matterId, item.matter.stage)
      return
    }
    toast.success(`Moved to ${stageLabel(nextStage)}`)
  }, [onStageChange])

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Matter</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Readiness</TableHead>
              <TableHead className="text-right">Docs</TableHead>
              <TableHead className="text-right">Drafts</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead>Practice</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matters.map((item, index) => {
              const matter = item.matter
              const readiness = hubReadinessLabel(item)
              const lastActivity = hubLastActivityAt(item)
              const focused = index === focusedIndex
              const updating = updatingId === matter.matter_id

              return (
                <TableRow
                  key={matter.matter_id}
                  data-state={focused ? 'selected' : undefined}
                  className={cn('cursor-pointer', updating && 'opacity-60')}
                  onClick={() => onOpen(matter.matter_id)}
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
                  <TableCell onClick={e => e.stopPropagation()}>
                    <select
                      value={matter.stage}
                      disabled={updating}
                      onChange={e => void handleStageSelect(item, e.target.value as MatterStage)}
                      className="max-w-[10rem] rounded border border-border bg-background px-2 py-1 text-xs"
                      aria-label={`Stage for ${matter.client_name ?? 'matter'}`}
                    >
                      {STAGES.map(stage => (
                        <option key={stage.key} value={stage.key}>{stage.label}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        'border-0 text-[10px]',
                        readiness.tone === 'success' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                      )}
                    >
                      {readiness.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.includedDocumentLabels.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.draftCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {lastActivity ? formatDate(lastActivity) : '—'}
                  </TableCell>
                  <TableCell className="max-w-[8rem] truncate text-muted-foreground">
                    {matter.practice_area || '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
