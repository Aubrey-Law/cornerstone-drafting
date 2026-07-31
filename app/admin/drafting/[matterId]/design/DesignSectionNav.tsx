'use client'

import { cn } from '@/lib/utils'
import type { DesignSheetGroupId } from '@/lib/designSheet/sectionIds'

export interface DesignSectionNavGroup {
  id: DesignSheetGroupId
  title: string
  blockingCount: number
  optionalCount: number
}

interface DesignSectionNavProps {
  groups: DesignSectionNavGroup[]
  /** Currently displayed section; `null` before the first selection resolves. */
  activeGroupId?: DesignSheetGroupId | null
  hideUnusedDecisions: boolean
  hiddenDecisionCount: number
  onHideUnusedChange: (checked: boolean) => void
  /** Switches the displayed section and updates the hash. */
  onSelectGroup: (groupId: DesignSheetGroupId) => void
}

/**
 * Section index for the design sheet. Rendered once — as the docked desktop
 * column and inside the mobile sheet — through `ResponsiveDetailRail`.
 */
export function DesignSectionNav({
  groups,
  activeGroupId = null,
  hideUnusedDecisions,
  hiddenDecisionCount,
  onHideUnusedChange,
  onSelectGroup,
}: DesignSectionNavProps) {
  return (
    <nav aria-label="Design sheet groups" className="w-full min-w-0 py-4">
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Design sheet
      </p>
      <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-2 py-2">
        <input
          type="checkbox"
          checked={hideUnusedDecisions}
          onChange={event => onHideUnusedChange(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-accent"
        />
        <span className="text-[11px] leading-4 text-foreground">
          Hide what this plan doesn&apos;t use
          <span className="block text-[10px] text-muted-foreground">
            {hiddenDecisionCount} decision{hiddenDecisionCount === 1 ? '' : 's'} hidden
          </span>
        </span>
      </label>
      <div className="space-y-1">
        {groups.map(group => (
          <button
            key={group.id}
            type="button"
            aria-current={group.id === activeGroupId ? 'page' : undefined}
            onClick={() => onSelectGroup(group.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium hover:bg-muted',
              group.id === activeGroupId ? 'bg-muted text-foreground' : 'text-foreground',
            )}
          >
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                group.blockingCount > 0
                  ? 'bg-warning'
                  : group.optionalCount > 0
                    ? 'bg-muted-foreground/40'
                    : 'bg-success',
              )}
            />
            <span className="min-w-0 flex-1">{group.title}</span>
            {group.blockingCount > 0 ? (
              <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                {group.blockingCount}
              </span>
            ) : null}
            {group.optionalCount > 0 ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {group.optionalCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  )
}
