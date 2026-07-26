'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatDate } from '@/lib/utils'
import { QUIET_DAYS, hubDaysSinceActivity, hubLastActivityAt, hubReadinessLabel } from '@/lib/drafting/hubUtils'
import { useDebouncedPrefetch } from '@/lib/useDebouncedPrefetch'
import { updateMatterStage } from '@/lib/drafting/updateMatterStage'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import {
  GROUP_COLORS,
  STAGES,
  stageGroupColor,
  stageInfo,
  stageLabel,
  type MatterStage,
  type StageGroup,
} from '@/types/database'

/** The board collapses the 11 stages into these 5 columns. */
const GROUP_ORDER: StageGroup[] = ['early', 'active', 'work', 'done', 'closed']

const GROUP_LABELS: Record<StageGroup, string> = {
  early: 'Intake',
  active: 'Drafting',
  work: 'Client work',
  done: 'Signing',
  closed: 'Closed',
}

/** Dropping on a column moves the matter to that group's first stage. */
function firstStageOfGroup(group: StageGroup): MatterStage {
  return (STAGES.find(stage => stage.group === group) ?? STAGES[0]).key
}

interface MatterPipelineKanbanProps {
  matters: DraftingHubMatter[]
  onOpen: (matterId: string) => void
  onStageChange: (matterId: string, stage: MatterStage) => void
}

export default function MatterPipelineKanban({ matters, onOpen, onStageChange }: MatterPipelineKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<StageGroup | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byGroup = useMemo(() => {
    const map = new Map<StageGroup, DraftingHubMatter[]>()
    for (const group of GROUP_ORDER) map.set(group, [])
    for (const item of matters) {
      const group = stageInfo(item.matter.stage).group
      const bucket = map.get(group) ?? []
      bucket.push(item)
      map.set(group, bucket)
    }
    return map
  }, [matters])

  const applyStage = useCallback(async (targetStage: MatterStage, matterId: string) => {
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
      return
    }
    toast.success(`Moved to ${stageLabel(targetStage)}`)
  }, [matters, onStageChange])

  const handleDrop = useCallback((group: StageGroup, matterId: string) => {
    void applyStage(firstStageOfGroup(group), matterId)
  }, [applyStage])

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
        {GROUP_ORDER.map(group => {
          const items = byGroup.get(group) ?? []
          const colors = GROUP_COLORS[group]
          const isTarget = dropTarget === group

          return (
            <section
              key={group}
              className={cn(
                'flex min-w-0 flex-col rounded-lg border bg-muted/20',
                isTarget ? 'border-accent ring-2 ring-accent/20' : 'border-border',
              )}
              onDragOver={e => {
                e.preventDefault()
                setDropTarget(group)
              }}
              onDragLeave={() => setDropTarget(current => (current === group ? null : current))}
              onDrop={e => {
                e.preventDefault()
                setDropTarget(null)
                const matterId = e.dataTransfer.getData('text/matter-id')
                if (matterId) handleDrop(group, matterId)
              }}
            >
              <header
                className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors.dot }} aria-hidden />
                  <h2 className="truncate text-xs font-semibold">{GROUP_LABELS[group]}</h2>
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
                      onStageSelect={stage => void applyStage(stage, item.matter.matter_id)}
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
  onStageSelect,
  onDragStart,
  onDragEnd,
}: {
  item: DraftingHubMatter
  dragging: boolean
  updating: boolean
  onOpen: () => void
  onStageSelect: (stage: MatterStage) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const matter = item.matter
  const readiness = hubReadinessLabel(item)
  const lastActivity = hubLastActivityAt(item)
  const quietDays = hubDaysSinceActivity(item)
  const isQuiet = quietDays !== null && quietDays >= QUIET_DAYS
  const stageColors = stageGroupColor(matter.stage)
  const draftingHref = `/admin/drafting/${matter.matter_id}`
  const { schedulePrefetch, cancelPrefetch } = useDebouncedPrefetch(draftingHref)

  return (
    <li>
      <article
        draggable
        onMouseEnter={schedulePrefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
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
          isQuiet ? 'border-red-strong-border hover:border-red-strong' : 'border-border hover:border-accent',
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
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={updating}
                className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                style={{ backgroundColor: stageColors.bg, color: stageColors.text }}
                aria-label={`Stage for ${matter.client_name || 'matter'}: ${stageLabel(matter.stage)}`}
                onClick={e => e.stopPropagation()}
              >
                <span className="truncate">{stageLabel(matter.stage)}</span>
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {GROUP_ORDER.map((group, groupIndex) => (
                <DropdownMenuGroup key={group}>
                  {groupIndex > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </DropdownMenuLabel>
                  {STAGES.filter(stage => stage.group === group).map(stage => (
                    <DropdownMenuItem
                      key={stage.key}
                      className="text-xs"
                      onSelect={() => onStageSelect(stage.key)}
                    >
                      {stage.label}
                      {stage.key === matter.stage && <span className="ml-auto text-[10px] text-muted-foreground">Current</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {isQuiet && (
            <span
              className="inline-flex items-center rounded-full bg-red-bg px-2 py-0.5 text-[10px] font-medium text-red"
              title={`No activity for ${quietDays} days`}
            >
              Quiet {quietDays}d
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
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
