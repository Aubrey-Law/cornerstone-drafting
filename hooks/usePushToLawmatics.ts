'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'

type PushResult = {
  prospectId: string
  operation: 'created' | 'updated'
  sent: string[]
  unmapped: string[]
  rejected: string[]
  rejectedDetails: string[]
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
      const notes = [
        result.rejected.length
          ? `Lawmatics refused ${result.rejected.join(', ')}, so they were left out${result.rejectedDetails.length ? ` (${result.rejectedDetails.join(' ')})` : ''}.`
          : null,
        result.unmapped.length ? `Not sent until mapped in Settings → Lawmatics: ${result.unmapped.join(', ')}` : null,
      ].filter(Boolean)
      const message = `${verb} — ${count}`
      const options = notes.length ? { description: notes.join(' '), duration: 15_000 } : undefined
      if (result.rejected.length) toast.warning(message, options)
      else toast.success(message, options)
      onPushed?.()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Push to Lawmatics failed', { duration: 15_000 })
    } finally {
      setPushing(false)
    }
  }, [intakeId, onPushed, pushing])

  return { push, pushing }
}
