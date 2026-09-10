'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocumentFolders, listDocuments } from '@/lib/documents'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'

type DocumentState = {
  matterId: string
  documents: MatterDocument[]
  folders: MatterDocumentFolder[]
  loading: boolean
  documentsError: string | null
  foldersError: string | null
}
const emptyState = (matterId: string): DocumentState => ({
  matterId, documents: [], folders: [], loading: true,
  documentsError: null, foldersError: null,
})

export function useMatterDocuments(matterId: string, enabled = true) {
  const [state, setState] = useState(() => emptyState(matterId))
  const generation = useRef(0)
  const requestedMatter = useRef<string | null>(null)

  const reload = useCallback(async () => {
    requestedMatter.current = matterId
    const request = ++generation.current
    setState(previous => ({
      ...(previous.matterId === matterId ? previous : emptyState(matterId)),
      loading: true,
    }))
    const [documents, folders] = await Promise.allSettled([
      listDocuments(matterId), listDocumentFolders(matterId),
    ])
    if (request !== generation.current) return
    setState(previous => ({
      matterId,
      documents: documents.status === 'fulfilled' ? documents.value : previous.documents,
      folders: folders.status === 'fulfilled' ? folders.value : previous.folders,
      documentsError: documents.status === 'rejected' ? 'Documents could not be refreshed. Please retry.' : null,
      foldersError: folders.status === 'rejected' ? 'Folders could not be refreshed. Please retry.' : null,
      loading: false,
    }))
  }, [matterId])

  useEffect(() => () => {
    generation.current += 1
    requestedMatter.current = null
  }, [matterId])

  useEffect(() => {
    if (enabled && requestedMatter.current !== matterId) void reload()
  }, [enabled, matterId, reload])

  // Do not expose the previous matter during the identity-change render.
  return { ...(state.matterId === matterId ? state : emptyState(matterId)), reload }
}
