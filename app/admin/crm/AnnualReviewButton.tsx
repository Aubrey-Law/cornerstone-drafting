'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'

export function AnnualReviewButton({ matterId }: { matterId: string }) {
  const token = useAccessToken()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const create = async () => {
    if (!token || pending) return
    setPending(true)
    try {
      const response = await fetch('/api/admin/crm/annual-reviews', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not create annual review')
      toast.success(payload?.created ? 'Annual review scheduled' : 'Annual review is already scheduled')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create annual review')
    } finally {
      setPending(false)
    }
  }
  return <Button size="sm" variant="outline" onClick={() => void create()} disabled={!token || pending}>
    {pending && <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />}
    Schedule review
  </Button>
}
