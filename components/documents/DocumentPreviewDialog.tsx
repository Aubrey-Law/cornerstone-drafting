'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getDocumentPreview, getDocumentUrl, isWordDocument } from '@/lib/documents'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

/**
 * Mammoth emits a small, predictable subset of HTML from a DOCX, but the source
 * document can be client-uploaded, so the markup is sanitized before it reaches
 * the DOM. Wider than the email allowlist because a legal instrument needs
 * headings, tables, and inline images to read correctly.
 *
 * Plain `dompurify`, not `isomorphic-dompurify` — see the note in
 * `components/admin/RichTextEmailEditor.tsx`: the isomorphic build drags jsdom
 * into the server bundle and kills the lambda at load.
 */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'span', 'div', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'pre', 'code', 'hr',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'colspan', 'rowspan'],
}

function sanitizePreviewHtml(html: string): string {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return ''
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

/**
 * The minimum a caller needs to preview a document. Callers that hold a full
 * `MatterDocument` satisfy this structurally; `ReviewStep` holds only an id and
 * a name, and Word detection falls back to the file extension there.
 */
export type PreviewableDocument = {
  id: string
  name: string
  content_type?: string | null
}

/**
 * Word documents are rendered in-process by `/api/documents/[id]/preview`, which
 * authenticates the reader and checks `userCanReadDocument` before converting
 * the DOCX to HTML. They are deliberately NOT handed to a third-party viewer:
 * doing so discloses a signed R2 URL for a client's will or trust to an outside
 * service. Everything else (PDF, images) streams from a short-lived signed URL
 * in an iframe.
 */
export function DocumentPreviewDialog({
  document,
  open,
  onOpenChange,
  onRevisionLoaded,
}: {
  document: PreviewableDocument | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRevisionLoaded?: (documentId: string, revision: string | null) => void
}) {
  const accessToken = useAccessToken()
  const revisionCallback = useRef(onRevisionLoaded)
  useEffect(() => { revisionCallback.current = onRevisionLoaded }, [onRevisionLoaded])
  const [url, setUrl] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isWord = document ? isWordDocument(document.name, document.content_type) : false
  const safeHtml = useMemo(() => (html === null ? null : sanitizePreviewHtml(html)), [html])

  useEffect(() => {
    if (!open || !document) {
      setUrl(null)
      setHtml(null)
      setError(null)
      return
    }

    let cancelled = false
    setUrl(null)
    setHtml(null)
    setError(null)
    revisionCallback.current?.(document.id, null)

    const load = isWordDocument(document.name, document.content_type)
      ? getDocumentPreview(document.id).then(({ html: value, reviewRevision }) => {
          if (!cancelled) { setHtml(value); revisionCallback.current?.(document.id, reviewRevision ?? null) }
        })
      : (async () => {
          if (revisionCallback.current && accessToken) {
            const response = await fetch(`/api/documents/${document.id}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
            if (!response.ok) throw new Error('Could not load document')
            const value = await response.json()
            if (!cancelled) { setUrl(value.url); revisionCallback.current?.(document.id, value.reviewRevision ?? null) }
          } else {
            const nextUrl = await getDocumentUrl(document.id, 'view')
            if (!cancelled) setUrl(nextUrl)
          }
        })()

    void load.catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load preview')
    })

    return () => {
      cancelled = true
    }
  }, [accessToken, document, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[85vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)] p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="truncate text-base">{document?.name ?? 'Document preview'}</DialogTitle>
          <DialogDescription>{isWord ? 'Preview Word document' : 'Preview PDF'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 bg-muted/30">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">{error}</div>
          ) : safeHtml !== null ? (
            <div className="h-full overflow-auto bg-background px-8 py-6">
              <div
                className="prose prose-sm mx-auto max-w-3xl dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            </div>
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
