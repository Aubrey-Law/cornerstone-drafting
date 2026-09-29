'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { MatterDocumentsTab } from '@/app/admin/matters/[id]/MatterDocumentsTab'
import { listDocumentFolders, listDocuments, listSignatureRequests } from '@/lib/documents'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'

export function useLeadDocuments(matterId: string | null | undefined) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [folders, setFolders] = useState<MatterDocumentFolder[]>([])
  const [signatureRequests, setSignatureRequests] = useState<SignatureRequestSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(matterId))

  const reload = useCallback(async () => {
    if (!matterId) {
      setError(null)
      setDocuments([])
      setFolders([])
      setSignatureRequests([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextDocuments, nextFolders, nextRequests] = await Promise.all([
        listDocuments(matterId),
        listDocumentFolders(matterId),
        listSignatureRequests(matterId),
      ])
      setDocuments(nextDocuments)
      setFolders(nextFolders)
      setSignatureRequests(nextRequests)
      setError(null)
    } catch {
      setError('Could not load documents. Please retry.')
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { documents, folders, signatureRequests, loading, error, reload }
}

type LeadDocumentsTabProps = {
  documents: MatterDocument[]
  folders?: MatterDocumentFolder[]
  loading: boolean
  error?: string | null
  matterId: string | null
  agreementStatus?: string | null
  agreementId: string | null
  clientName?: string | null
  onDocumentsChanged: () => void | Promise<void>
  /** A lead is a matter, so the same send works here. Off by default. */
  esignDocumentsEnabled?: boolean
  signatureRequests?: SignatureRequestSummary[]
  defaultSigner?: { name: string; email: string } | null
}

export function LeadDocumentsTab({
  documents,
  folders = [],
  loading,
  error = null,
  matterId,
  agreementId,
  agreementStatus,
  clientName,
  onDocumentsChanged,
  esignDocumentsEnabled = false,
  signatureRequests = [],
  defaultSigner = null,
}: LeadDocumentsTabProps) {
  if (!matterId) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={FileText}
          title="Documents unavailable"
          description="Document storage is unavailable because this lead is not linked to an opportunity record."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {agreementId && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Engagement agreement</p>
            <p className="text-micro text-muted-foreground">{agreementStatus === 'completed' || agreementStatus === 'signed' ? 'Signed' : agreementStatus === 'partially_signed' ? 'Partially signed' : agreementStatus === 'viewed' ? 'Viewed by recipient' : agreementStatus === 'sent' ? 'Sent for signature' : agreementStatus === 'sending' ? 'Sending' : 'Draft in progress'}</p>
          </div>
          <Button asChild type="button" size="sm" variant="outline">
            <Link href={`/admin/engagements/${agreementId}?step=design`}>Open</Link>
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm">
          <p>{error}{documents.length > 0 ? ' Showing previously loaded documents.' : ''}</p>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onDocumentsChanged()}>Retry</Button>
        </div>
      )}
      {(!error || documents.length > 0) && <MatterDocumentsTab
        matterId={matterId}
        documents={documents}
        folders={folders}
        loading={loading}
        onDocumentsChanged={onDocumentsChanged}
        clientName={clientName}
        recordLabel="lead"
        esignDocumentsEnabled={esignDocumentsEnabled}
        signatureRequests={signatureRequests}
        defaultSigner={defaultSigner}
      />}
    </div>
  )
}
