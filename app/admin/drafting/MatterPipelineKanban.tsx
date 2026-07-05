'use client'

import { useCallback, useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import { hubLastActivityAt, hubReadinessLabel } from '@/lib/drafting/hubUtils'
import { updateMatterStage } from '@/lib/drafting/updateMatterStage'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import { STAGES, stageGroupColor, stageInfo, stageLabel, type MatterStage } from '@/types/database'

interface MatterPipelineKanbanProps {
  matters: DraftingHubMatter[]
  onOpen: (matterId: string) => void
  onStageChange: (matterId: string, stage: MatterStage) => void
}

export default function MatterPipelineKanban({ matters, onOpen, onStageChange }: MatterPipelineKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<MatterStage | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byStage = useMemo(() => {
    const map = new Map<MatterStage, DraftingHubMatter[]>()
    for (const stage of STAGES) map.set(stage.key, [])
    for (const item of matters) {
      const key = item.matter.stage
      const bucket = map.get(key) ?? []
      bucket.push(item)
      map.set(key, bucket)
    }
    return map
  }, [matters])

  const handleDrop = useCallback(async (targetStage: MatterStage, matterId: string) => {
    const item = matters.find(m => m.matter.matter_id === matterId)
    if (!item || item.matter.stage === targetStage) return

    setError(null)
    setUpdatingId(matterId)
    onStageChange(matterId, targetStage)

    const result = await updateMatterStage(matterId, targetStage)
    setUpdatingId(null)

    if (!result.ok) {
      setError(result.error)
      onStageChange(matterId, item.matter.stage)
    }
  }, [matters, onStageChange])

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map(stage => {
          const items = byStage.get(stage.key) ?? []
          const colors = stageGroupColor(stage.key)
          const isTarget = dropTarget === stage.key

          return (
            <section
              key={stage.key}
              className={cn(
                'flex w-[min(100%,17rem)] shrink-0 flex-col rounded-lg border bg-muted/20',
                isTarget ? 'border-accent ring-2 ring-accent/20' : 'border-border',
              )}
              onDragOver={e => {
                e.preventDefault()
                setDropTarget(stage.key)
              }}
              onDragLeave={() => setDropTarget(current => (current === stage.key ? null : current))}
              onDrop={e => {
                e.preventDefault()
                setDropTarget(null)
                const matterId = e.dataTransfer.getData('text/matter-id')
                if (matterId) void handleDrop(stage.key, matterId)
              }}
            >
              <header
                className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors.dot }} aria-hidden />
                  <h2 className="truncate text-xs font-semibold">{stage.label}</h2>
                </div>
                <Badge variant="outline" className="border-current/20 bg-background/60 text-[10px] tabular-nums">
                  {items.length}
                </Badge>
              </header>
              <ul className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <li className="rounded-md border border-dashed border-border px-2 py-6 text-center text-[11px] text-muted-foreground">
                    Drop matters here
                  </li>
                ) : (
                  items.map(item => (
                    <KanbanCard
                      key={item.matter.matter_id}
                      item={item}
                      dragging={draggingId === item.matter.matter_id}
                      updating={updatingId === item.matter.matter_id}
                      onOpen={() => onOpen(item.matter.matter_id)}
                      onDragStart={() => setDraggingId(item.matter.matter_id)}
                      onDragEnd={() => setDraggingId(null)}
                    />
                  ))
                )}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({
  item,
  dragging,
  updating,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: DraftingHubMatter
  dragging: boolean
  updating: boolean
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const matter = item.matter
  const readiness = hubReadinessLabel(item)
  const lastActivity = hubLastActivityAt(item)
  const stage = stageInfo(matter.stage)

  return (
    <li>
      <article
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/matter-id', matter.matter_id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        className={cn(
          'rounded-md border bg-card p-2.5 shadow-sm transition-opacity',
          dragging ? 'opacity-50' : 'opacity-100',
          updating && 'pointer-events-none opacity-60',
          'border-border hover:border-accent',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-semibold text-foreground hover:text-accent">
              {matter.client_name || 'Unnamed client'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {[item.matterNumber, matter.matter_name || matter.plan_type || 'Matter'].filter(Boolean).join(' · ')}
            </p>
          </button>
          <Badge
            className={cn(
              'shrink-0 border-0 text-[10px]',
              readiness.tone === 'success' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
            )}
          >
            {readiness.label}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{stage.label}</span>
          <span>·</span>
          <span>{item.includedDocumentLabels.length} docs</span>
          <span>·</span>
          <span>{item.draftCount} draft{item.draftCount === 1 ? '' : 's'}</span>
          {lastActivity && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Clock className="h-3 w-3" aria-hidden />
                {formatDate(lastActivity)}
              </span>
            </>
          )}
        </div>
      </article>
    </li>
  )
}
