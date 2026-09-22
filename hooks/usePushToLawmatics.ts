'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'

type PushResult = {
  prospectId: string
  operation: 'created' | 'updated'
  sent: string[]
  unmapped: string[]
}

/** Manual "Push to Lawmatics" for a lead or client's intake record. */
export function usePushToLawmatics(intakeId: string | null | undefined, onPushed?: () => void) {
  const [pushing, setPushing] = useState(false)

  const push = useCallback(async () => {
    if (!intakeId || pushing) return
    setPushing(true)
    try {
      const result = await apiRequest<PushResult>('/api/lawmatics/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeId }),
      }, 'Push to Lawmatics failed')
      const verb = result.operation === 'created' ? 'Created in Lawmatics' : 'Updated in Lawmatics'
      const count = `${result.sent.length} field${result.sent.length === 1 ? '' : 's'} sent`
      toast.success(`${verb} — ${count}`, result.unmapped.length ? {
        description: `Not sent until mapped to a Lawmatics custom field: ${result.unmapped.join(', ')}`,
        duration: 10_000,
      } : undefined)
      onPushed?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Push to Lawmatics failed')
    } finally {
      setPushing(false)
    }
  }, [intakeId, onPushed, pushing])

  return { push, pushing }
}
