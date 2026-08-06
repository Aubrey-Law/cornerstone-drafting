'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Combine,
  Download,
  Eye,
  FileSearch,
  FileText,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CombineWordDraftsDialog } from '@/components/drafting/CombineWordDraftsDialog'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { DocumentStatusBadges } from '@/components/documents/DocumentStatusBadges'
import {
  buildDocumentStatusBadges,
  isDocumentPdf,
  isDocumentShared,
  isDocumentWord,
} from '@/lib/documentWorkspace'
import {
  deleteDocument,
  downloadDocumentsZip,
  getDocumentAuditEvents,
  getDocumentUrl,
  getDocumentViewerUrl,
  renameDocument,
  setDocumentShared,
  uploadDocument,
} from '@/lib/documents'
import { cn, formatDateTime } from '@/lib/utils'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { DocumentAccessAudit, MatterDocument } from '@/types/database'
import { documentDisplayTitle } from '@/lib/documentDisplayTitle'

type Scope = 'all' | 'shared' | 'client'

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function auditLabel(event: DocumentAccessAudit) {
  if (event.action === 'share') return 'Shared with client'
  if (event.action === 'unshare') return 'Unshared'
  if (event.action === 'rename') return 'Renamed'
  if (event.action === 'review') return 'Review state changed'
  if (event.action === 'delete') return 'Deleted'
  return event.action
}

interface MatterDocumentsTabProps {
  matterId: string
  documents: MatterDocument[]
  loading: boolean
  onDocumentsChanged: () => void | Promise<void>
  unreviewedUploadCounts?: UnreviewedUploadCounts
  onReviewPortalUploads?: () => void | Promise<void>
  onReviewIntakeUploads?: () => void | Promise<void>
  clientName?: string | null
  deepLinkedDocumentId?: string | null
  recordLabel?: 'matter' | 'lead'
}

export function MatterDocumentsTab({
  matterId,
  documents,
  loading,
  onDocumentsChanged,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  onReviewPortalUploads,
  onReviewIntakeUploads,
  clientName,
  deepLinkedDocumentId,
  recordLabel = 'matter',
}: MatterDocumentsTabProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<MatterDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MatterDocument | null>(null)
  const [previewTarget, setPreviewTarget] = useState<MatterDocument | null>(null)
  const [combineOpen, setCombineOpen] = useState(false)
  const [auditTarget, setAuditTarget] = useState<MatterDocument | null>(null)
  const [auditEvents, setAuditEvents] = useState<DocumentAccessAudit[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null)

  useEffect(() => {
    if (!deepLinkedDocumentId) return
    const target = documents.find(candidate => candidate.id === deepLinkedDocumentId)
    if (!target) return
    setScope('all')
    setQuery('')
    setHighlightedDocumentId(target.id)
    const scrollTimer = window.setTimeout(() => {
      window.document.getElementById(`document-row-${target.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
    const highlightTimer = window.setTimeout(() => setHighlightedDocumentId(null), 2500)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [deepLinkedDocumentId, documents])

  // Meeting notes have their own card on the matter page.
  const visibleDocuments = useMemo(
    () => documents.filter(doc => doc.source !== 'meeting-notes'),
    [documents],
  )

  const counts = useMemo(() => ({
    all: visibleDocuments.length,
    shared: visibleDocuments.filter(isDocumentShared).length,
    client: visibleDocuments.filter(doc => doc.source === 'client').length,
  }), [visibleDocuments])

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return visibleDocuments.filter(doc => {
      if (scope === 'shared' && !isDocumentShared(doc)) return false
      if (scope === 'client' && doc.source !== 'client') return false
      if (normalized && !doc.name.toLowerCase().includes(normalized)) return false
      return true
    })
  }, [query, scope, visibleDocuments])

  const selectedDocuments = useMemo(
    () => visibleDocuments.filter(doc => selectedIds.has(doc.id)),
    [visibleDocuments, selectedIds],
  )
  const selectedCombinableDocs = useMemo(
    () => selectedDocuments
      .filter(doc => isDocumentWord(doc) && doc.name.toLowerCase().endsWith('.docx'))
      .map(doc => ({ id: doc.id, name: doc.name })),
    [selectedDocuments],
  )

  const allVisibleSelected =
    filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedIds.has(doc.id))

  const refresh = async () => {
    await onDocumentsChanged()
  }

  const toggleSelected = (docId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(docId)
      else next.delete(docId)
      return next
    })
  }

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const doc of filteredDocuments) {
        if (checked) next.add(doc.id)
        else next.delete(doc.id)
      }
      return next
    })
  }

  const openDocument = async (doc: MatterDocument, action: 'view' | 'download') => {
    setBusy(`${action}:${doc.id}`)
    try {
      const url = action === 'view'
        ? await getDocumentViewerUrl(doc.id, doc.name, doc.content_type)
        : await getDocumentUrl(doc.id, 'download')
      if (action === 'view') {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = doc.name
      anchor.click()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load document')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async (docs: MatterDocument[], shared: boolean) => {
    if (docs.length === 0) return
    setBusy(shared ? 'share' : 'unshare')
    try {
      for (const doc of docs) {
        await setDocumentShared(doc.id, shared)
      }
      const verb = shared ? 'Shared' : 'Unshared'
      toast.success(`${verb} ${docs.length} document${docs.length === 1 ? '' : 's'}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update sharing')
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedDocuments.length === 0) return
    setBusy('bulk-download')
    try {
      await downloadDocumentsZip(selectedDocuments.map(doc => doc.id))
      toast.success(`Downloaded ${selectedDocuments.length} document${selectedDocuments.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download selected documents')
    } finally {
      setBusy(null)
    }
  }

  const handleUpload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadDocument(file, matterId)
      toast.success(`Uploaded ${file.name}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload document')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const handleRename = async () => {
    const doc = renameTarget
    const nextName = renameValue.trim()
    if (!doc || !nextName) return
    setBusy(`rename:${doc.id}`)
    try {
      await renameDocument(doc.id, nextName)
      toast.success('Document renamed')
      setRenameTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename document')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    const doc = deleteTarget
    if (!doc) return
    setBusy(`delete:${doc.id}`)
    try {
      await deleteDocument(doc.id)
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
      toast.success('Document deleted')
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete document')
    } finally {
      setBusy(null)
    }
  }

  const openAudit = async (doc: MatterDocument) => {
    setAuditTarget(doc)
    setAuditLoading(true)
    try {
      setAuditEvents(await getDocumentAuditEvents({ matterId, documentId: doc.id }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load history')
      setAuditEvents([])
    } finally {
      setAuditLoading(false)
    }
  }

  const scopes: Array<{ value: Scope; label: string; count: number }> = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'shared', label: 'Shared', count: counts.shared },
    { value: 'client', label: 'From client', count: counts.client },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {recordLabel === 'lead' ? 'Lead documents' : 'Matter documents'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Everything filed to this {recordLabel}. Flip the switch to show a document in the client portal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={event => void handleUpload(event.target.files)}
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </Button>
          </div>
        </div>

        {(unreviewedUploadCounts.intake > 0 || unreviewedUploadCounts.portal > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-amber-bg px-4 py-2 text-sm">
            <span className="text-amber">
              {unreviewedUploadCounts.total} upload{unreviewedUploadCounts.total === 1 ? '' : 's'} need review.
            </span>
            <div className="flex flex-wrap gap-2">
              {unreviewedUploadCounts.portal > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => void onReviewPortalUploads?.()}>
                  Mark portal uploads reviewed
                </Button>
              )}
              {unreviewedUploadCounts.intake > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => void onReviewIntakeUploads?.()}>
                  Review intake uploads
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1" role="group" aria-label="Filter documents">
            {scopes.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  scope === option.value
                    ? 'bg-primary/10 font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {option.label} <span className="tabular-nums">{option.count}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
              placeholder="Search documents"
            />
          </div>
        </div>

        {selectedDocuments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'bulk-download'} onClick={() => void handleDownloadSelected()}>
              {busy === 'bulk-download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download selected
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'share'} onClick={() => void handleShare(selectedDocuments.filter(doc => !isDocumentShared(doc)), true)}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'unshare'} onClick={() => void handleShare(selectedDocuments.filter(isDocumentShared), false)}>
              <Undo2 className="h-3.5 w-3.5" />
              Unshare
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedCombinableDocs.length < 2} onClick={() => setCombineOpen(true)}>
              <Combine className="h-3.5 w-3.5" />
              Combine Word documents
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">
              {query.trim() || scope !== 'all' ? 'No matching documents' : 'No documents yet'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {query.trim() || scope !== 'all'
                ? 'Clear the search or filter to see everything.'
                : 'Upload a file to get started.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={checked => toggleAllVisible(checked === true)}
                    aria-label="Select all visible documents"
                  />
                </TableHead>
                <TableHead>Document</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Shared</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.map(doc => {
                const issues = (doc.marker_count ?? 0) + (doc.missing_count ?? 0)
                return (
                  <TableRow
                    key={doc.id}
                    id={`document-row-${doc.id}`}
                    data-state={selectedIds.has(doc.id) ? 'selected' : undefined}
                    className={cn(highlightedDocumentId === doc.id && 'bg-amber-100/70 ring-1 ring-inset ring-amber-400 dark:bg-amber-950/30')}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(doc.id)}
                        onCheckedChange={checked => toggleSelected(doc.id, checked === true)}
                        aria-label={`Select ${doc.name}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p
                            className="break-words text-sm font-medium"
                            title={doc.name}
                            aria-label={`${documentDisplayTitle(doc.name, clientName)}. Full filename: ${doc.name}`}
                          >
                            {documentDisplayTitle(doc.name, clientName)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(doc.size)}
                            {doc.created_at ? ` · ${formatDateTime(doc.created_at)}` : ''}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <DocumentStatusBadges badges={buildDocumentStatusBadges(doc).slice(0, 2)} />
                            {issues > 0 && (
                              <span className="text-xs font-medium text-amber">
                                {issues} issue{issues === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        {doc.source === 'client' ? 'Client' : 'Firm'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={isDocumentShared(doc)}
                        disabled={busy === 'share' || busy === 'unshare'}
                        onCheckedChange={checked => void handleShare([doc], checked)}
                        aria-label={`Share ${doc.name} with the client`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-xs"
                          aria-label={isDocumentPdf(doc) ? `Preview PDF ${doc.name}` : `View ${doc.name}`}
                          onClick={() => isDocumentPdf(doc) ? setPreviewTarget(doc) : void openDocument(doc, 'view')}
                        >
                          {busy === `view:${doc.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          View
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions for ${doc.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isDocumentPdf(doc) && (
                              <DropdownMenuItem onSelect={() => void openDocument(doc, 'view')}>
                                <FileSearch className="mr-2 h-4 w-4" />Open original
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => void openDocument(doc, 'download')}>
                              <Download className="mr-2 h-4 w-4" />Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setRenameTarget(doc); setRenameValue(doc.name) }}>
                              <Pencil className="mr-2 h-4 w-4" />Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void openAudit(doc)}>
                              <History className="mr-2 h-4 w-4" />History
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(doc)}>
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={renameTarget !== null} onOpenChange={open => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Update the display name shown in the document list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="document-name">Name</Label>
            <Input id="document-name" value={renameValue} onChange={event => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!renameValue.trim() || busy?.startsWith('rename:')} onClick={() => void handleRename()}>
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        document={previewTarget}
        open={previewTarget !== null}
        onOpenChange={open => !open && setPreviewTarget(null)}
      />

      <CombineWordDraftsDialog
        open={combineOpen}
        onOpenChange={setCombineOpen}
        documents={selectedCombinableDocs}
        defaultFilename="combined-matter-drafts.docx"
      />

      <Sheet open={auditTarget !== null} onOpenChange={open => !open && setAuditTarget(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Document history</SheetTitle>
            <SheetDescription>{auditTarget?.name ?? 'Recent document history'}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {auditLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : auditEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recorded history.</p>
            ) : (
              auditEvents.map(event => (
                <div key={event.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{auditLabel(event)}</p>
                      <p className="text-xs text-muted-foreground">{event.user_email ?? 'Unknown user'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
