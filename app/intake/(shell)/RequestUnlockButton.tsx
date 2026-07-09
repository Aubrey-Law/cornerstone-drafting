'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { requestIntakeUnlock } from './actions'

export function RequestUnlockButton({ requestedAt }: { requestedAt: string | null }) {
  const [pending, startTransition] = useTransition()
  const [sentAt, setSentAt] = useState<string | null>(requestedAt)

  if (sentAt) {
    return (
      <p className="text-sm text-amber-800">
        Unlock requested — we&apos;ll reach out shortly to reopen your questionnaire.
      </p>
    )
  }

  function onClick() {
    startTransition(async () => {
      try {
        const res = await requestIntakeUnlock()
        setSentAt(res.requestedAt)
        toast.success("Unlock requested — we'll reach out shortly.")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not send your request. Please email us instead.')
      }
    })
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? 'Sending…' : 'Request Unlock'}
    </Button>
  )
}
