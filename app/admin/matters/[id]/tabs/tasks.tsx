'use client'

import { memo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { MatterEngineStageTaskCard } from '@/components/admin/MatterEngineStageTaskCard'
import type { StageTaskRow } from '@/lib/queries/stageTasks'
import type { MatterStage } from '@/types/database'

interface MatterTasksTabProps {
  matterStage: MatterStage
  engineStageTask?: StageTaskRow | null
  engineStageTaskLoading?: boolean
  onEngineStageTaskUpdated?: (task: StageTaskRow) => void
}

function MatterTasksTabImpl({
  engineStageTask,
  engineStageTaskLoading,
  onEngineStageTaskUpdated,
}: MatterTasksTabProps) {
  return (
    <TabsContent value="tasks" className="mt-0 space-y-3">
      {engineStageTaskLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : engineStageTask && onEngineStageTaskUpdated ? (
        <MatterEngineStageTaskCard task={engineStageTask} onUpdated={onEngineStageTaskUpdated} />
      ) : (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-xs text-muted-foreground">
          No open stage SLA task for the current stage. Tasks appear when the matter enters attorney-owned stages like Drafting or Revisions.
        </div>
      )}
    </TabsContent>
  )
}

export const MatterTasksTab = memo(MatterTasksTabImpl)
