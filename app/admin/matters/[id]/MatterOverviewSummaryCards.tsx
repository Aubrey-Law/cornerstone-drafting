'use client'

import type { StageTaskRow } from '@/lib/queries/stageTasks'
import type { MatterTab } from '@/lib/matterPageTabs'

interface MatterOverviewSummaryCardsProps {
  peopleCount: number
  assetCount: number
  documentCount: number
  engineStageTask: StageTaskRow | null | undefined
  onNavigate: (tab: MatterTab, section?: string) => void
}

export function MatterOverviewSummaryCards({
  peopleCount,
  assetCount,
  documentCount,
  engineStageTask,
  onNavigate,
}: MatterOverviewSummaryCardsProps) {
  const items: Array<{ label: string; count: number; action: () => void }> = [
    { label: 'People', count: peopleCount, action: () => onNavigate('people') },
    { label: 'Assets', count: assetCount, action: () => onNavigate('assets') },
    { label: 'Documents', count: documentCount, action: () => onNavigate('documents') },
    {
      label: 'Tasks',
      count: engineStageTask ? 1 : 0,
      action: () => document.getElementById('matter-open-task')?.scrollIntoView({ behavior: 'smooth' }),
    },
  ]

  return (
    <nav aria-label="Matter collection counts" className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4">
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          className="flex items-baseline justify-between gap-3 border-b border-r border-border px-4 py-3 text-left last:border-r-0 hover:bg-muted/40 sm:border-b-0"
          onClick={item.action}
        >
          <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
          <span className="text-lg font-semibold tabular-nums">{item.count}</span>
        </button>
      ))}
    </nav>
  )
}
