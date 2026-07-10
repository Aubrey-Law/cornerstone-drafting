'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { MatterDetailsRow } from '@/types/matter-details'

export function useMatterDetailsSave(matterId: string, initial: MatterDetailsRow | null) {
  const [details, setDetails] = useState<MatterDetailsRow | null>(initial)

  useEffect(() => {
    setDetails(initial)
  }, [initial])

  const saveField = useCallback(
    async (field: keyof MatterDetailsRow, value: unknown) => {
      const normalizedValue = value === '' ? null : value
      try {
        const response = await fetch('/api/admin/matter-details', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matterId, field, value: normalizedValue }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `Failed to save ${field}`)
        setDetails(prev => ({ ...(prev ?? {}), [field]: normalizedValue, ...(data.row ?? {}) }))
        toast.success('Saved', { duration: 1200 })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Save failed')
        throw error
      }
    },
    [matterId],
  )

  return { details, saveField, setDetails }
}
