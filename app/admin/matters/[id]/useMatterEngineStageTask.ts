'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { mapMatterStageToEngine } from '@/lib/stage-engine/labels'
import { stageTaskProgress } from '@/lib/stage-engine/stageTaskProgress'
import type { StageTaskRow } from '@/lib/queries/stageTasks'
import type { MatterStage } from '@/types/database'

export function useMatterEngineStageTask(matterId: string, currentStage: MatterStage) {
  const [tasks, setTasks] = useState<StageTaskRow[]>([])
  const [loading, setLoading] = useState(true)

  const engineStage = mapMatterStageToEngine(currentStage)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/stage-tasks`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      setTasks((json.tasks ?? []) as StageTaskRow[])
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    void refresh()
  }, [refresh, currentStage])

  const currentTask = useMemo(
    () => (engineStage ? tasks.find(t => t.stage_key === engineStage && t.status === 'open') ?? null : null),
    [engineStage, tasks],
  )

  const progress = useMemo(
    () => (currentTask ? stageTaskProgress(currentTask) : { done: 0, total: 0, isComplete: false }),
    [currentTask],
  )

  const handleUpdated = useCallback((updated: StageTaskRow) => {
    setTasks(prev => {
      if (updated.status === 'done') return prev.filter(t => t.id !== updated.id)
      return prev.map(t => (t.id === updated.id ? updated : t))
    })
  }, [])

  return {
    currentEngineStageTask: currentTask,
    engineStageTaskLoading: loading,
    engineStageTaskProgress: progress,
    refreshEngineStageTask: refresh,
    handleEngineStageTaskUpdated: handleUpdated,
  }
}
