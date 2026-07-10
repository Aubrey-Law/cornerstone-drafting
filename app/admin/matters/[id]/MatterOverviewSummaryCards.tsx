'use client'

import type { ReactNode } from 'react'
import { ArrowRight, Briefcase, FileText, ListTodo, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StageTaskRow } from '@/lib/queries/stageTasks'
import type { MatterTab } from '@/lib/matterPageTabs'

interface HouseholdPreview {
  clientName: string | null
  spouseName: string | null
  childCount: number
  loading: boolean
}

interface MatterOverviewSummaryCardsProps {
  household: HouseholdPreview
  assetCount: number | null
  assetNetValue: number | null
  assetsLoading: boolean
  documentCount: number
  documentsLoading: boolean
  engineStageTask: StageTaskRow | null | undefined
  engineStageTaskLoading: boolean
  onNavigate: (tab: MatterTab, section?: string) => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function SummaryCard({
  icon,
  title,
  preview,
  detail,
  loading,
  onViewAll,
}: {
  icon: ReactNode
  title: string
  preview: string
  detail?: string
  loading?: boolean
  onViewAll: () => void
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">{preview}</p>
          {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3 h-7 w-fit gap-1 px-0 text-xs"
        onClick={onViewAll}
      >
        View all
        <ArrowRight className="h-3 w-3" />
      </Button>
    </div>
  )
}

export function MatterOverviewSummaryCards({
  household,
  assetCount,
  assetNetValue,
  assetsLoading,
  documentCount,
  documentsLoading,
  engineStageTask,
  engineStageTaskLoading,
  onNavigate,
}: MatterOverviewSummaryCardsProps) {
  const householdPreview = household.loading
    ? '—'
    : [
        household.clientName,
        household.spouseName,
      ].filter(Boolean).join(' · ') || 'No household data'

  const householdDetail = household.loading
    ? undefined
    : household.childCount === 0
      ? 'No children listed'
      : `${household.childCount} child${household.childCount === 1 ? '' : 'ren'}`

  const assetsPreview = assetsLoading
    ? '—'
    : assetCount === null
      ? 'Open to view inventory'
      : assetCount === 0
        ? 'No assets yet'
        : `${assetCount} asset${assetCount === 1 ? '' : 's'}`

  const assetsDetail =
    assetNetValue !== null && assetNetValue > 0
      ? `${formatCurrency(assetNetValue)} net value`
      : undefined

  const documentsPreview = documentsLoading
    ? '—'
    : documentCount === 0
      ? 'No documents yet'
      : `${documentCount} document${documentCount === 1 ? '' : 's'}`

  const taskPreview = engineStageTaskLoading
    ? '—'
    : engineStageTask
      ? engineStageTask.title
      : 'No open task'

  const taskDetail =
    engineStageTask?.hard_due_at
      ? `Due ${new Date(engineStageTask.hard_due_at).toLocaleDateString()}`
      : engineStageTask
        ? 'Stage SLA task'
        : undefined

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        icon={<Users className="h-3.5 w-3.5" />}
        title="Household"
        preview={householdPreview}
        detail={householdDetail}
        loading={household.loading}
        onViewAll={() => onNavigate('people', 'household')}
      />
      <SummaryCard
        icon={<Briefcase className="h-3.5 w-3.5" />}
        title="Assets"
        preview={assetsPreview}
        detail={assetsDetail}
        loading={assetsLoading}
        onViewAll={() => onNavigate('assets')}
      />
      <SummaryCard
        icon={<FileText className="h-3.5 w-3.5" />}
        title="Documents"
        preview={documentsPreview}
        loading={documentsLoading}
        onViewAll={() => onNavigate('documents')}
      />
      <SummaryCard
        icon={<ListTodo className="h-3.5 w-3.5" />}
        title="Open task"
        preview={taskPreview}
        detail={taskDetail}
        loading={engineStageTaskLoading}
        onViewAll={() => {
          if (engineStageTask) {
            document.getElementById('matter-open-task')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }}
      />
    </div>
  )
}
