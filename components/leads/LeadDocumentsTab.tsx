'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { documentDisplayTitle } from '@/lib/documentDisplayTitle'
import { documentFolderLabel } from '@/lib/documentWorkspace'
import { getDocumentUrl, listDocuments } from '@/lib/documents'
import { formatDateTime } from '@/lib/utils'
import type { MatterDocument } from '@/types/database'

/**
 * Lead-stage files are read-only in this pass: a lead only has documents once it
 * is linked to a matter, and the engagement draft lives on the agreement record.
 */
export function useLeadDocuments(matterId: string | null | undefined) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [loading, setLoading] = useState(Boolean(matterId))

  useEffect(() => {
    if (!matterId) {
      setDocuments([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void listDocuments(matterId)
      .then(rows => { if (!cancelled) setDocuments(rows) })
      .catch(() => { if (!cancelled) setDocuments([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [matterId])

  return { documents, loading }
}

type LeadDocumentsTabProps = {
  documents: MatterDocument[]
  loading: boolean
  matterId: string | null
  agreementId: string | null
}

async function openDocument(document: MatterDocument) {
  try {
    const url = await getDocumentUrl(document.id, 'view')
    window.open(url, '_blank', 'noopener')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not open document')
  }
}

export function LeadDocumentsTab({ documents, loading, matterId, agreementId }: LeadDocumentsTabProps) {
  const empty = documents.length === 0 && !agreementId

  if (loading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading documents…</p>
  }

  if (empty) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {matterId
          ? 'No documents on this lead yet.'
          : 'Lead-stage files appear here once an engagement is drafted or the lead becomes a matter.'}
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {agreementId && (
          <li className="flex items-center gap-3 px-4 py-2.5">
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Engagement agreement</p>
              <p className="text-[11px] text-muted-foreground">Draft in progress</p>
            </div>
            <Button asChild type="button" size="sm" variant="outline">
              <Link href={`/admin/engagements/${agreementId}?step=design`}>Open</Link>
            </Button>
          </li>
        )}
        {documents.map(document => (
          <li className="flex items-center gap-3 px-4 py-2.5" key={document.id}>
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{documentDisplayTitle(document.name)}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatDateTime(document.created_at)}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {documentFolderLabel(document.folder)}
            </Badge>
            <Button type="button" size="sm" variant="outline" onClick={() => void openDocument(document)}>
              View
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
