'use client'

import { useCallback, useEffect, useState } from 'react'
import { listDocumentFolders, listDocuments } from '@/lib/documents'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'

export function useMatterDocuments(matterId: string) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [folders, setFolders] = useState<MatterDocumentFolder[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      // One await so a folder list that fails doesn't blank the documents, and
      // vice versa — each falls back to empty on its own.
      const [nextDocuments, nextFolders] = await Promise.all([
        listDocuments(matterId).catch(() => [] as MatterDocument[]),
        listDocumentFolders(matterId).catch(() => [] as MatterDocumentFolder[]),
      ])
      setDocuments(nextDocuments)
      setFolders(nextFolders)
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { documents, folders, loading, reload }
}
