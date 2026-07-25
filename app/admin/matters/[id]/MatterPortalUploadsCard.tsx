'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Download, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn, formatDateTime } from '@/lib/utils'
import { getDocumentUrl, listDocuments } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface MatterPortalUploadsCardProps {
  matterId: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onOpened?: () => void
}

export function MatterPortalUploadsCard({
  matterId,
  open,
  defaultOpen = false,
  onOpenChange,
  onOpened,
}: MatterPortalUploadsCardProps) {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = open ?? uncontrolledOpen

  const setOpen = useCallback((next: boolean) => {
    if (next && !isOpen) {
      onOpened?.()
    }
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [isOpen, onOpenChange, onOpened, open])

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const docs = await listDocuments(matterId, 'client')
      setDocuments(docs)
    } catch {
      setDocuments([])
      toast.error('Could not load portal uploads')
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    if (!isOpen) return
    void loadDocuments()
  }, [isOpen, loadDocuments])

  async function handleDownload(doc: MatterDocument) {
    setDownloadingId(doc.id)
    try {
      const url = await getDocumentUrl(doc.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <Collapsible
      id="portal-uploads"
      open={isOpen}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30">
        <div>
          <h3 className="text-sm font-semibold">Portal uploads</h3>
          <p className="text-xs text-muted-foreground">
            Files the client uploaded from their Documents page.
          </p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('border-t border-border px-4 py-4')}>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading portal uploads…
          </div>
        ) : documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No portal uploads yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.map(doc => (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatSize(doc.size)}
                    {doc.created_at ? ` · ${formatDateTime(doc.created_at)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent"
                  disabled={downloadingId === doc.id}
                  onClick={() => void handleDownload(doc)}
                >
                  {downloadingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
