'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MatterDocumentsTab } from '@/app/admin/matters/[id]/MatterDocumentsTab'
import { listDocuments } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export function useLeadDocuments(matterId: string | null | undefined) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [loading, setLoading] = useState(Boolean(matterId))

  const reload = useCallback(async () => {
    if (!matterId) {
      setDocuments([])
      setLoading(false)
      return
    }
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

type LeadDocumentsTabProps = {
  documents: MatterDocument[]
  loading: boolean
  matterId: string | null
  agreementId: string | null
  clientName?: string | null
  onDocumentsChanged: () => void | Promise<void>
}

export function LeadDocumentsTab({
  documents,
  loading,
  matterId,
  agreementId,
  clientName,
  onDocumentsChanged,
}: LeadDocumentsTabProps) {
  if (!matterId) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Document storage is unavailable because this lead is not linked to an opportunity record.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {agreementId && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Engagement agreement</p>
            <p className="text-[11px] text-muted-foreground">Draft in progress</p>
          </div>
          <Button asChild type="button" size="sm" variant="outline">
            <Link href={`/admin/engagements/${agreementId}?step=design`}>Open</Link>
          </Button>
        </div>
      )}
      <MatterDocumentsTab
        matterId={matterId}
        documents={documents}
        loading={loading}
        onDocumentsChanged={onDocumentsChanged}
        clientName={clientName}
        recordLabel="lead"
      />
    </div>
  )
}
