'use client'

import { Download, Eye, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getDocumentUrl, getDocumentViewerUrl } from '@/lib/documents'
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

function folderLabel(doc: MatterDocument) {
  if (doc.folder === 'review') return 'For your review'
  if (doc.folder === 'signed' || doc.folder === 'final') return 'Signed copy'
  return 'Shared document'
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
    <div className="flex flex-col gap-3 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-muted/40 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-bold uppercase text-muted-foreground">
          PDF
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {folderLabel(doc)}
            </span>
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
          className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          title="View document"
          aria-label={`View ${doc.name}`}
        >
          {viewPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          <span className="hidden sm:inline">{viewPending ? 'Opening' : 'View'}</span>
        </button>
        <button
          type="button"
          onClick={() => onAction(doc, 'download')}
          disabled={anyPending}
          className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          title="Download document"
          aria-label={`Download ${doc.name}`}
        >
          {downloadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">{downloadPending ? 'Starting' : 'Download'}</span>
        </button>
      </div>
    </div>
  )
}

export default function PortalDocumentList({ documents }: { documents: MatterDocument[] }) {
  const [pending, setPending] = useState<{ id: string; action: DocumentAction } | null>(null)

  const sharedDrafts = documents.filter(doc => doc.folder === 'review')
  const signedDocuments = documents.filter(doc => doc.folder === 'signed' || doc.folder === 'final')

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
      <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center">
        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">No documents have been shared yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDFs your attorney shares for review or signing will appear here.
        </p>
      </div>
    )
  }

  async function handleDocumentAction(doc: MatterDocument, action: DocumentAction) {
    setPending({ id: doc.id, action })
    try {
      const url = action === 'view'
        ? await getDocumentViewerUrl(doc.id, doc.name, doc.content_type)
        : await getDocumentUrl(doc.id, action)

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

      {[
        { title: 'Documents for your review', docs: sharedDrafts, empty: 'No review PDFs have been shared yet.' },
        { title: 'Signed documents', docs: signedDocuments, empty: 'No signed PDFs have been shared yet.' },
      ].map(section => (
        <section key={section.title} className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{section.title}</p>
            <p className="text-xs text-muted-foreground">
              {section.docs.length} document{section.docs.length === 1 ? '' : 's'}
            </p>
          </div>
          {section.docs.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">{section.empty}</p>
          ) : section.docs.map((doc) => (
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
      ))}
    </div>
  )
}
