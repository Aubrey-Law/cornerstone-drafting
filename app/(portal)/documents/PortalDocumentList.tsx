'use client'

import { Download, Eye, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { EmptyState } from '@/components/EmptyState'
import { Card } from '@/components/ui/card'
import { getDocumentUrl, isWordDocument } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

type DocumentAction = 'view' | 'download'

function formatSize(bytes: number) {
  if (!bytes) return 'Size unavailable'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function DocumentRow({
  doc,
  anyPending,
  viewPending,
  downloadPending,
  onAction,
}: {
  doc: MatterDocument
  anyPending: boolean
  viewPending: boolean
  downloadPending: boolean
  onAction: (doc: MatterDocument, action: DocumentAction) => void
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-accent sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-micro font-bold uppercase text-muted-foreground">
          {(doc.name.split('.').pop() ?? 'file').slice(0, 4)}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatSize(doc.size)} · Shared {formatDate(doc.created_at)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:self-center">
        <button
          type="button"
          onClick={() => onAction(doc, 'view')}
          disabled={anyPending}
          className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          title="View document"
          aria-label={`View ${doc.name}`}
        >
          {viewPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          <span>{viewPending ? 'Opening' : 'View'}</span>
        </button>
        <button
          type="button"
          onClick={() => onAction(doc, 'download')}
          disabled={anyPending}
          className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          title="Download document"
          aria-label={`Download ${doc.name}`}
        >
          {downloadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{downloadPending ? 'Starting' : 'Download'}</span>
        </button>
      </div>
    </div>
  )
}

export default function PortalDocumentList({ documents }: { documents: MatterDocument[] }) {
  const [pending, setPending] = useState<{ id: string; action: DocumentAction } | null>(null)
  const [previewTarget, setPreviewTarget] = useState<MatterDocument | null>(null)

  const documentSummary = useMemo(() => {
    const count = documents.length
    const latest = documents[0]?.created_at
    return {
      count,
      latest: latest ? formatDate(latest) : null,
    }
  }, [documents])

  if (documents.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={FileText}
          title="No documents shared yet"
          description="PDFs your attorney shares for review or signing will appear here."
        />
      </Card>
    )
  }

  async function handleDocumentAction(doc: MatterDocument, action: DocumentAction) {
    // Word documents are previewed in-app. This path used to open Microsoft's
    // Office Online viewer with a signed R2 URL, which disclosed a client's own
    // will or trust to a third party to render it.
    if (action === 'view' && isWordDocument(doc.name, doc.content_type)) {
      setPreviewTarget(doc)
      return
    }
    setPending({ id: doc.id, action })
    try {
      const url = await getDocumentUrl(doc.id, action)

      if (action === 'view') {
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) {
          toast.error('Your browser blocked the document window')
        }
        return
      }

      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = doc.name
      anchor.rel = 'noopener noreferrer'
      anchor.click()
      toast.success('Download started')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open document')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {documentSummary.count} shared document{documentSummary.count === 1 ? '' : 's'}
          </p>
          {documentSummary.latest && (
            <p className="text-xs text-muted-foreground">Most recent: {documentSummary.latest}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secure links
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Shared documents</p>
          <p className="text-xs text-muted-foreground">
            {documents.length} document{documents.length === 1 ? '' : 's'}
          </p>
        </div>
        {documents.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            anyPending={pending !== null}
            viewPending={pending?.id === doc.id && pending.action === 'view'}
            downloadPending={pending?.id === doc.id && pending.action === 'download'}
            onAction={handleDocumentAction}
          />
        ))}
      </section>

      <DocumentPreviewDialog
        document={previewTarget}
        open={previewTarget !== null}
        onOpenChange={open => !open && setPreviewTarget(null)}
      />
    </div>
  )
}
