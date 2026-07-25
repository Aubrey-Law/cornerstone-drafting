'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { MatterDetailsRow } from '@/types/matter-details'

export function useMatterDetailsSave(matterId: string, initial: MatterDetailsRow | null) {
  const [details, setDetails] = useState<MatterDetailsRow | null>(initial)
  const [savingField, setSavingField] = useState<keyof MatterDetailsRow | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetails(initial)
  }, [initial])

  const saveField = useCallback(
    async (
      field: keyof MatterDetailsRow,
      value: unknown,
      options?: { manual?: boolean },
    ) => {
      const normalizedValue = value === '' ? null : value
      setSavingField(field)
      setError(null)
      try {
        const response = await fetch('/api/admin/matter-details', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matterId,
            field,
            value: normalizedValue,
            ...(options?.manual === undefined ? {} : { manual: options.manual }),
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `Failed to save ${field}`)
        setDetails(prev => ({ ...(prev ?? {}), [field]: normalizedValue, ...(data.row ?? {}) }))
        setLastSavedAt(new Date().toISOString())
        toast.success('Saved', { id: 'matter-details-save', duration: 1200 })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed'
        setError(message)
        toast.error(message)
        throw error
      } finally {
        setSavingField(null)
      }
    },
    [matterId],
  )

  return { details, saveField, setDetails, savingField, lastSavedAt, error }
}
