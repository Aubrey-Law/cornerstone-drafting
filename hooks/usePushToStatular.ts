'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'

type PushResult = { statularClientId: string; operation: 'created' | 'reused' | 'updated' }

/** Manual "Push to Statular" for a lead or client's intake record. */
export function usePushToStatular(intakeId: string | null | undefined, onPushed?: () => void) {
  const [pushing, setPushing] = useState(false)

  const push = useCallback(async () => {
    if (!intakeId || pushing) return
    setPushing(true)
    try {
      const result = await apiRequest<PushResult>('/api/statular/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeId }),
      }, 'Push to Statular failed')
      if (result.operation === 'created') {
        toast.success(`Created in Statular — client ${result.statularClientId}`)
      } else {
        toast.info(`Already in Statular — client ${result.statularClientId}`, {
          description: 'Statular cannot be updated from Cornerstone; make later changes in Statular.',
          duration: 10_000,
        })
      }
      onPushed?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Push to Statular failed', { duration: 15_000 })
    } finally {
      setPushing(false)
    }
  }, [intakeId, onPushed, pushing])

  return { push, pushing }
}
