'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronDown, Download, FileText, Loader2, NotebookPen, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { cn, formatDateTime } from '@/lib/utils'
import { getDocumentUrl, listDocuments } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

const AddMeetingNotesDialog = dynamic(
  () => import('@/components/meeting-notes/AddMeetingNotesDialog').then(m => ({ default: m.AddMeetingNotesDialog })),
  { ssr: false },
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface MatterMeetingNotesCardProps {
  matterId: string
  defaultOpen?: boolean
}

export function MatterMeetingNotesCard({
  matterId,
  defaultOpen = false,
}: MatterMeetingNotesCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const docs = await listDocuments(matterId, 'meeting-notes')
      setDocuments(docs)
    } catch {
      setDocuments([])
      toast.error('Could not load meeting notes')
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => {
    if (!open) return
    void loadDocuments()
  }, [open, loadDocuments])

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
    <>
      <Collapsible
        id="meeting-notes"
        open={open}
        onOpenChange={setOpen}
        className="rounded-lg border border-border bg-card"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <CollapsibleTrigger className="min-w-0 flex-1 text-left hover:opacity-90">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Meeting notes</h3>
                <p className="text-xs text-muted-foreground">
                  Internal staff notes from Granola or manual entry. Not visible to clients.
                </p>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <CollapsibleContent className={cn('border-t border-border px-4 py-4')}>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading meeting notes…
            </div>
          ) : documents.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">No meeting notes yet.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setDialogOpen(true)}
              >
                <NotebookPen className="h-3.5 w-3.5" />
                Import from Granola
              </Button>
            </div>
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
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary"
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

      {dialogOpen && (
        <AddMeetingNotesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          target={{ kind: 'matter', id: matterId }}
          onImported={() => {
            setOpen(true)
            void loadDocuments()
          }}
        />
      )}
    </>
  )
}
