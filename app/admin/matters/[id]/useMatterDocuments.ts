'use client'

import { useCallback, useEffect, useState } from 'react'
import { listDocuments } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export function useMatterDocuments(matterId: string) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setDocuments(await listDocuments(matterId))
    } catch {
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { documents, loading, reload }
}
