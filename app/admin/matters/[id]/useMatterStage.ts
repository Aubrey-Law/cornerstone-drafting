'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { stageLabel, type MatterStage, type PipelineMatter } from '@/types/database'

export type StageLifecyclePreflight = {
  stage: MatterStage
  version: string
  blockers: Array<{
    key: string
    label: string
    owner: string
    resolution: string
  }>
}

/**
 * Stage moves for the matter page. A forward move the lifecycle registry
 * flags comes back 409 with its blockers; the caller shows them and confirms
 * through `handleStageChange(stage, { version, blockerKeys })`.
 */
export function useMatterStage({ matter, setMatter, token }: {
  matter: PipelineMatter
  setMatter: Dispatch<SetStateAction<PipelineMatter>>
  token: string | null
}) {
  const router = useRouter()
  const [stageSaving, setStageSaving] = useState(false)
  const [stagePreflight, setStagePreflight] = useState<StageLifecyclePreflight | null>(null)
  const [closingMatter, setClosingMatter] = useState(false)

  const handleStageChange = useCallback(async (
    stage: MatterStage,
    confirmation?: { version: string; blockerKeys: string[] },
  ): Promise<boolean> => {
    if (!token || stage === matter.stage) return false
    setStageSaving(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stage,
          confirmBlockers: Boolean(confirmation),
          lifecycleVersion: confirmation?.version,
          confirmedBlockerKeys: confirmation?.blockerKeys,
        }),
      })
      const body = await res.json().catch(() => ({})) as {
        error?: string
        requiresConfirmation?: boolean
        lifecycle?: {
          version?: string
          targetStage?: MatterStage
          blockers?: StageLifecyclePreflight['blockers']
        }
      }
      if (res.status === 409 && body.requiresConfirmation && body.lifecycle?.version) {
        setStagePreflight({
          stage: body.lifecycle.targetStage ?? stage,
          version: body.lifecycle.version,
          blockers: body.lifecycle.blockers ?? [],
        })
        return false
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not update stage')
      const blockers = body.lifecycle?.blockers ?? []
      setMatter(current => ({ ...current, stage }))
      setStagePreflight(null)
      if (blockers.length) {
        toast.warning(`Stage updated after confirming ${blockers.length} lifecycle blocker${blockers.length === 1 ? '' : 's'}`)
      } else {
        toast.success(`Stage updated to ${stageLabel(stage)}`)
      }
      router.refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update stage')
      return false
    } finally {
      setStageSaving(false)
    }
  }, [matter.matter_id, matter.stage, router, setMatter, token])

  /**
   * Close-out is one server action: the stage route runs the billing check,
   * moves both axes, stamps the closed and retention dates, and offers the
   * client a closing notice (lib/fileClosing). Nothing is saved from here.
   */
  const handleCloseMatter = useCallback(async () => {
    if (closingMatter) return
    setClosingMatter(true)
    try {
      await handleStageChange('closed')
    } finally {
      setClosingMatter(false)
    }
  }, [closingMatter, handleStageChange])

  return { stageSaving, stagePreflight, setStagePreflight, handleStageChange, closingMatter, handleCloseMatter }
}
