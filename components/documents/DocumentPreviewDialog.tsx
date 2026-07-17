'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getDocumentViewerUrl } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export function DocumentPreviewDialog({
  document,
  open,
  onOpenChange,
}: {
  document: MatterDocument | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !document) {
      setUrl(null)
      setError(null)
      return
    }

    let cancelled = false
    setUrl(null)
    setError(null)
    void getDocumentViewerUrl(document.id, document.name, document.content_type, { embed: true })
      .then(nextUrl => {
        if (!cancelled) setUrl(nextUrl)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load preview')
      })

    return () => {
      cancelled = true
    }
  }, [document, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[85vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)] p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="truncate text-base">{document?.name ?? 'Document preview'}</DialogTitle>
          <DialogDescription>Preview PDF</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 bg-muted/30">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">{error}</div>
          ) : url ? (
            <iframe title={document?.name ?? 'PDF preview'} src={url} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading preview...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
