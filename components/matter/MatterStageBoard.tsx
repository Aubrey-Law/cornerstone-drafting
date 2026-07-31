'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { QUIET_DAYS } from '@/lib/drafting/hubUtils'
import {
  STAGE_GROUP_LABELS,
  STAGE_GROUP_ORDER,
  firstStageOfGroup,
} from '@/lib/matter/stageGroups'
import { useDebouncedPrefetch } from '@/lib/useDebouncedPrefetch'
import { updateMatterStage } from '@/lib/drafting/updateMatterStage'
import {
  GROUP_COLORS,
  STAGES,
  stageGroupColor,
  stageInfo,
  stageLabel,
  type MatterStage,
  type StageGroup,
} from '@/types/database'

/**
 * A matter as the board needs it. Callers map their own row shape onto this so
 * the drag-and-drop, stage picker and optimistic save live in one place.
 */
export interface StageBoardCard {
  id: string
  stage: MatterStage
  title: string
  subtitle?: string | null
  /** Status pill in the card header. */
  badge?: { label: string; tone: 'success' | 'warning' | 'muted' } | null
  /** Short facts rendered on the card footer, joined with a middot. */
  meta?: ReactNode[]
  /** Whole days since the matter last moved; past QUIET_DAYS the card is flagged. */
  quietDays?: number | null
  /** Prefetched on hover/focus and opened by `onOpen`. */
  href: string
}

const BADGE_TONE_CLASS: Record<'success' | 'warning' | 'muted', string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  muted: 'bg-muted text-muted-foreground',
}

interface MatterStageBoardProps {
  cards: StageBoardCard[]
  onOpen: (matterId: string) => void
  /** Applied immediately and rolled back by the board if the save fails. */
  onStageChange: (matterId: string, stage: MatterStage) => void
  /** Names the board region for screen readers. */
  label?: string
}

/** Stage pipeline board shared by the Matters list and the Drafting hub. */
export function MatterStageBoard({
  cards,
  onOpen,
  onStageChange,
  label = 'Matter pipeline board',
}: MatterStageBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<StageGroup | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byGroup = useMemo(() => {
    const map = new Map<StageGroup, StageBoardCard[]>()
    for (const group of STAGE_GROUP_ORDER) map.set(group, [])
    for (const card of cards) {
      const group = stageInfo(card.stage).group
      const bucket = map.get(group) ?? []
      bucket.push(card)
      map.set(group, bucket)
    }
    return map
  }, [cards])

  const applyStage = useCallback(async (targetStage: MatterStage, matterId: string) => {
    const card = cards.find(item => item.id === matterId)
    if (!card || card.stage === targetStage) return

    setError(null)
    setUpdatingId(matterId)
    onStageChange(matterId, targetStage)

    const result = await updateMatterStage(matterId, targetStage)
    setUpdatingId(null)

    if (!result.ok) {
      setError(result.error)
      onStageChange(matterId, card.stage)
      return
    }
    toast.success(`Moved to ${stageLabel(targetStage)}`)
  }, [cards, onStageChange])

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
      <div
        role="group"
        aria-label={label}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5"
      >
        {STAGE_GROUP_ORDER.map(group => {
          const items = byGroup.get(group) ?? []
          const colors = GROUP_COLORS[group]
          const isTarget = dropTarget === group

          return (
            <section
              key={group}
              aria-label={`${STAGE_GROUP_LABELS[group]} · ${items.length}`}
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
                  <h2 className="truncate text-xs font-semibold">{STAGE_GROUP_LABELS[group]}</h2>
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
                  items.map(card => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      dragging={draggingId === card.id}
                      updating={updatingId === card.id}
                      onOpen={() => onOpen(card.id)}
                      onStageSelect={stage => void applyStage(stage, card.id)}
                      onDragStart={() => setDraggingId(card.id)}
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

function BoardCard({
  card,
  dragging,
  updating,
  onOpen,
  onStageSelect,
  onDragStart,
  onDragEnd,
}: {
  card: StageBoardCard
  dragging: boolean
  updating: boolean
  onOpen: () => void
  onStageSelect: (stage: MatterStage) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const isQuiet = card.quietDays != null && card.quietDays >= QUIET_DAYS
  const stageColors = stageGroupColor(card.stage)
  const { schedulePrefetch, cancelPrefetch } = useDebouncedPrefetch(card.href)

  return (
    <li>
      <article
        draggable
        onMouseEnter={schedulePrefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
        onDragStart={e => {
          e.dataTransfer.setData('text/matter-id', card.id)
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
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-foreground hover:text-accent">{card.title}</p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{card.subtitle}</p>
            )}
          </button>
          {card.badge && (
            <Badge className={cn('shrink-0 border-0 text-[10px]', BADGE_TONE_CLASS[card.badge.tone])}>
              {card.badge.label}
            </Badge>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={updating}
                className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                style={{ backgroundColor: stageColors.bg, color: stageColors.text }}
                aria-label={`Stage for ${card.title}: ${stageLabel(card.stage)}`}
                onClick={e => e.stopPropagation()}
              >
                <span className="truncate">{stageLabel(card.stage)}</span>
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {STAGE_GROUP_ORDER.map((group, groupIndex) => (
                <DropdownMenuGroup key={group}>
                  {groupIndex > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {STAGE_GROUP_LABELS[group]}
                  </DropdownMenuLabel>
                  {STAGES.filter(stage => stage.group === group).map(stage => (
                    <DropdownMenuItem
                      key={stage.key}
                      className="text-xs"
                      onSelect={() => onStageSelect(stage.key)}
                    >
                      {stage.label}
                      {stage.key === card.stage && <span className="ml-auto text-[10px] text-muted-foreground">Current</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {isQuiet && (
            <span
              className="inline-flex items-center rounded-full bg-red-bg px-2 py-0.5 text-[10px] font-medium text-red"
              title={`No activity for ${card.quietDays} days`}
            >
              Quiet {card.quietDays}d
            </span>
          )}
        </div>
        {card.meta && card.meta.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {card.meta.map((entry, index) => (
              // Index keys are stable here: `meta` is a fixed-length list built
              // per card, never reordered or filtered after render.
              <span key={index} className="inline-flex items-center gap-1.5">
                {index > 0 && <span aria-hidden>·</span>}
                {entry}
              </span>
            ))}
          </div>
        )}
      </article>
    </li>
  )
}
