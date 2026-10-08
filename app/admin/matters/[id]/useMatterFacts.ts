'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import type { MatterType } from '@/lib/matter/matterType'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { useMatterDetailsSave } from './useMatterDetailsSave'

/**
 * The editable matter facts behind the Details panel: matter_details fields,
 * the matter type and the matter number. A saved field the pipeline row also
 * carries (signing date, practice area, plan type) is mirrored onto `matter`
 * so the header and Overview update without a refresh.
 */
export function useMatterFacts({ matterId, token, setMatter, initialDetails, initialMatterType, initialMatterNumber }: {
  matterId: string
  token: string | null
  setMatter: Dispatch<SetStateAction<PipelineMatter>>
  initialDetails: MatterDetailsRow | null
  initialMatterType: MatterType | null
  initialMatterNumber: string | null
}) {
  const { details, saveField: saveDetailField, setDetails, savingField, lastSavedAt, error } = useMatterDetailsSave(matterId, initialDetails)
  const [matterNumber, setMatterNumber] = useState<string | null>(initialMatterNumber)
  const [matterType, setMatterType] = useState<MatterType | null>(initialMatterType)
  const [matterTypeSaving, setMatterTypeSaving] = useState(false)

  useEffect(() => { setMatterNumber(initialMatterNumber) }, [initialMatterNumber])

  const saveField = useCallback(async (field: keyof MatterDetailsRow, value: unknown, options?: { manual?: boolean }) => {
    await saveDetailField(field, value, options)
    if (field === 'signing_date' && (typeof value === 'string' || value === null)) {
      setMatter(current => ({ ...current, signing_date: value }))
    }
    if (field === 'practice_area' && typeof value === 'string') {
      setMatter(current => ({ ...current, practice_area: value }))
    }
    if (field === 'plan_type' && typeof value === 'string') {
      setMatter(current => ({ ...current, plan_type: value }))
    }
    if (field === 'matter_number') {
      setMatterNumber(typeof value === 'string' && value.trim() ? value.trim() : null)
    }
  }, [saveDetailField, setMatter])

  const saveMatterType = useCallback(async (next: MatterType) => {
    setMatterTypeSaving(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/matter-type`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ matterType: next }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Could not save matter type')
      setMatterType(next)
      toast.success('Matter type saved', { id: 'matter-type-save', duration: 1200 })
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save matter type')
      throw caught
    } finally {
      setMatterTypeSaving(false)
    }
  }, [matterId, token])

  return { details, setDetails, saveField, savingField, lastSavedAt, error, matterNumber, matterType, matterTypeSaving, saveMatterType }
}
