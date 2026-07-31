'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { MatterStageBoard, type StageBoardCard } from '@/components/matter/MatterStageBoard'
import { formatDate } from '@/lib/utils'
import { hubDaysSinceActivity, hubLastActivityAt, hubReadinessLabel } from '@/lib/drafting/hubUtils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { MatterStage } from '@/types/database'

interface MatterPipelineKanbanProps {
  matters: DraftingHubMatter[]
  onOpen: (matterId: string) => void
  onStageChange: (matterId: string, stage: MatterStage) => void
}

/** Drafting-hub view of the shared stage board: readiness, docs and draft counts. */
export default function MatterPipelineKanban({ matters, onOpen, onStageChange }: MatterPipelineKanbanProps) {
  const cards = useMemo<StageBoardCard[]>(() => matters.map(item => {
    const matter = item.matter
    const readiness = hubReadinessLabel(item)
    const lastActivity = hubLastActivityAt(item)

    return {
      id: matter.matter_id,
      stage: matter.stage,
      title: matter.client_name || 'Unnamed client',
      subtitle: [item.matterNumber, matter.matter_name || matter.plan_type || 'Matter']
        .filter(Boolean)
        .join(' · '),
      badge: { label: readiness.label, tone: readiness.tone },
      quietDays: hubDaysSinceActivity(item),
      href: `/admin/drafting/${matter.matter_id}`,
      meta: [
        `${item.includedDocumentLabels.length} docs`,
        `${item.draftCount} draft${item.draftCount === 1 ? '' : 's'}`,
        ...(lastActivity
          ? [
              <>
                <Clock className="h-3 w-3" aria-hidden />
                {formatDate(lastActivity)}
              </>,
            ]
          : []),
      ],
    }
  }), [matters])

  return (
    <MatterStageBoard
      cards={cards}
      onOpen={onOpen}
      onStageChange={onStageChange}
      label="Drafting pipeline board"
    />
  )
}
