'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocumentFolders, listDocuments, listSignatureRequests } from '@/lib/documents'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'

type DocumentState = {
  matterId: string
  documents: MatterDocument[]
  folders: MatterDocumentFolder[]
  signatureRequests: SignatureRequestSummary[]
  loading: boolean
  documentsError: string | null
  foldersError: string | null
}
const emptyState = (matterId: string): DocumentState => ({
  matterId, documents: [], folders: [], signatureRequests: [], loading: true,
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
    // Signature requests ride along rather than fetching separately: the badge
    // belongs to the same view of the list, and allSettled means an endpoint
    // the firm has not enabled cannot blank the tab.
    const [documents, folders, requests] = await Promise.allSettled([
      listDocuments(matterId), listDocumentFolders(matterId), listSignatureRequests(matterId),
    ])
    if (request !== generation.current) return
    setState(previous => ({
      matterId,
      documents: documents.status === 'fulfilled' ? documents.value : previous.documents,
      folders: folders.status === 'fulfilled' ? folders.value : previous.folders,
      signatureRequests: requests.status === 'fulfilled' ? requests.value : previous.signatureRequests,
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
