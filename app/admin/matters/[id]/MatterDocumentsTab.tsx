'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Combine,
  Download,
  Eye,
  FileSearch,
  FileText,
  FolderInput,
  History,
  Loader2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { CombineWordDraftsDialog } from '@/components/drafting/CombineWordDraftsDialog'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { DocumentStatusBadges } from '@/components/documents/DocumentStatusBadges'
import { PromoteDocumentDialog } from '@/components/documents/PromoteDocumentDialog'
import {
  buildDocumentStatusBadges,
  buildSelectedDocumentEligibility,
  classifyDocumentVisibility,
  DEFAULT_SHARE_FOLDER,
  DEFAULT_UNSHARE_FOLDER,
  DOCUMENT_FOLDERS,
  documentFileType,
  documentFolderDescription,
  documentFolderLabel,
  FIRM_SHARED_FOLDERS,
  getDocumentShareEligibility,
  isDocumentPdf,
  type DocumentFolder,
  type FileTypeFilter,
  type VisibilityFilter,
} from '@/lib/documentWorkspace'
import {
  deleteDocument,
  downloadDocumentsZip,
  getDocumentAuditEvents,
  getDocumentUrl,
  getDocumentViewerUrl,
  renameDocument,
  updateDocumentFolder,
  uploadDocument,
} from '@/lib/documents'
import { cn, formatDateTime } from '@/lib/utils'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { DocumentAccessAudit, MatterDocument } from '@/types/database'

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function auditLabel(event: DocumentAccessAudit) {
  if (event.action === 'folder_change') {
    const from = typeof event.metadata.from_folder === 'string' ? event.metadata.from_folder : null
    const to = typeof event.metadata.to_folder === 'string' ? event.metadata.to_folder : null
    if (from && to) return `${from} to ${to}`
  }
  if (event.action === 'rename') return 'Renamed'
  if (event.action === 'review') return 'Review state changed'
  if (event.action === 'delete') return 'Deleted'
  if (event.action === 'version') return 'Version history viewed'
  if (event.action === 'convert') return 'Converted'
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
}

export function MatterDocumentsTab({
  matterId,
  documents,
  loading,
  onDocumentsChanged,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  onReviewPortalUploads,
  onReviewIntakeUploads,
}: MatterDocumentsTabProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState<DocumentFolder>('draft')
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all')
  const [uploadFolder, setUploadFolder] = useState<DocumentFolder>('client')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<MatterDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<MatterDocument | null>(null)
  const [moveFolder, setMoveFolder] = useState<DocumentFolder>('draft')
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveFolder, setBulkMoveFolder] = useState<DocumentFolder>('draft')
  const [deleteTarget, setDeleteTarget] = useState<MatterDocument | null>(null)
  const [previewTarget, setPreviewTarget] = useState<MatterDocument | null>(null)
  const [pendingShareDocs, setPendingShareDocs] = useState<MatterDocument[]>([])
  const [pendingShareFolder, setPendingShareFolder] = useState<DocumentFolder>(DEFAULT_SHARE_FOLDER)
  const [combineOpen, setCombineOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditTarget, setAuditTarget] = useState<MatterDocument | null>(null)
  const [auditEvents, setAuditEvents] = useState<DocumentAccessAudit[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return documents.filter(doc => {
      if (doc.folder !== activeFolder) return false
      if (normalized && !doc.name.toLowerCase().includes(normalized)) return false
      if (visibilityFilter !== 'all' && classifyDocumentVisibility(doc) !== visibilityFilter) return false
      if (typeFilter !== 'all' && documentFileType(doc) !== typeFilter) return false
      return true
    })
  }, [activeFolder, documents, query, typeFilter, visibilityFilter])

  const folderSummaries = useMemo(() => DOCUMENT_FOLDERS.map(folder => ({
    ...folder,
    count: documents.filter(doc => doc.folder === folder.value).length,
  })), [documents])

  const activeFolderSummary = folderSummaries.find(folder => folder.value === activeFolder)

  const selectedDocuments = useMemo(
    () => documents.filter(doc => selectedIds.has(doc.id)),
    [documents, selectedIds],
  )
  const selectedEligibility = useMemo(
    () => buildSelectedDocumentEligibility(selectedDocuments),
    [selectedDocuments],
  )
  const selectedCombinableDocs = useMemo(
    () => selectedDocuments
      .filter(doc => selectedEligibility.combinableWordIds.includes(doc.id))
      .map(doc => ({ id: doc.id, name: doc.name })),
    [selectedDocuments, selectedEligibility.combinableWordIds],
  )

  const commandCounts = useMemo(() => ({
    internal: documents.filter(doc => classifyDocumentVisibility(doc) === 'internal').length,
    firmSharedPdfs: documents.filter(doc => classifyDocumentVisibility(doc) === 'firm-shared' && isDocumentPdf(doc)).length,
    clientUploads: documents.filter(doc => classifyDocumentVisibility(doc) === 'client-upload').length,
    portalUploadsNeedReview: unreviewedUploadCounts.portal,
    markerIssues: documents.filter(doc => (doc.marker_count ?? 0) > 0 || (doc.missing_count ?? 0) > 0).length,
    superseded: documents.filter(doc => Boolean(doc.superseded_at)).length,
    versioned: documents.filter(doc => Boolean(doc.current_version_id)).length,
  }), [documents, unreviewedUploadCounts.portal])

  const allVisibleSelected = filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedIds.has(doc.id))
  const pendingShareDoc = pendingShareDocs[0] ?? null

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
      await uploadDocument(file, matterId, uploadFolder)
      toast.success(`Uploaded ${file.name}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload document')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const openRename = (doc: MatterDocument) => {
    setRenameTarget(doc)
    setRenameValue(doc.name)
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

  const openMove = (doc: MatterDocument) => {
    setMoveTarget(doc)
    setMoveFolder(doc.folder)
  }

  const beginShare = (docs: MatterDocument[], toFolder: DocumentFolder = DEFAULT_SHARE_FOLDER) => {
    const eligible = docs.filter(doc => getDocumentShareEligibility(doc).ok)
    const blocked = docs.length - eligible.length
    if (eligible.length === 0) {
      toast.error(blocked > 1 ? 'No selected PDFs can be shared' : 'This PDF cannot be shared yet')
      return
    }
    if (blocked > 0) {
      toast.warning(`${blocked} selected document${blocked === 1 ? '' : 's'} blocked by sharing rules`)
    }
    setPendingShareDocs(eligible)
    setPendingShareFolder(toFolder)
  }

  const handleConfirmedShare = async () => {
    if (pendingShareDocs.length === 0) return
    setBusy('share')
    try {
      for (const doc of pendingShareDocs) {
        await updateDocumentFolder(doc.id, pendingShareFolder, { confirmed: true })
      }
      toast.success(`Shared ${pendingShareDocs.length} PDF${pendingShareDocs.length === 1 ? '' : 's'}`)
      setPendingShareDocs([])
      setMoveTarget(null)
      setBulkMoveOpen(false)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share document')
    } finally {
      setBusy(null)
    }
  }

  const handleMove = async () => {
    const doc = moveTarget
    if (!doc) return
    if (FIRM_SHARED_FOLDERS.has(moveFolder)) {
      beginShare([doc], moveFolder)
      return
    }
    setBusy(`move:${doc.id}`)
    try {
      await updateDocumentFolder(doc.id, moveFolder)
      toast.success(`Moved to ${documentFolderLabel(moveFolder)}`)
      setMoveTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move document')
    } finally {
      setBusy(null)
    }
  }

  const handleBulkMove = async () => {
    if (selectedDocuments.length === 0) return
    if (FIRM_SHARED_FOLDERS.has(bulkMoveFolder)) {
      beginShare(selectedDocuments, bulkMoveFolder)
      return
    }
    setBusy('bulk-move')
    try {
      for (const doc of selectedDocuments) {
        await updateDocumentFolder(doc.id, bulkMoveFolder)
      }
      toast.success(`Moved ${selectedDocuments.length} document${selectedDocuments.length === 1 ? '' : 's'}`)
      setBulkMoveOpen(false)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move selected documents')
    } finally {
      setBusy(null)
    }
  }

  const handleUnshare = async (docs: MatterDocument[]) => {
    if (docs.length === 0) return
    setBusy('unshare')
    try {
      for (const doc of docs) {
        await updateDocumentFolder(doc.id, DEFAULT_UNSHARE_FOLDER)
      }
      toast.success(`Unshared ${docs.length} document${docs.length === 1 ? '' : 's'}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not unshare document')
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
    setAuditOpen(true)
    setAuditLoading(true)
    try {
      const events = await getDocumentAuditEvents({ matterId, documentId: doc.id })
      setAuditEvents(events)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load audit history')
      setAuditEvents([])
    } finally {
      setAuditLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Matter documents</h3>
            <p className="text-xs text-muted-foreground">
              Upload, review, share, and organize every file tied to this matter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={uploadFolder} onValueChange={value => setUploadFolder(value as DocumentFolder)}>
              <SelectTrigger size="sm" className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_FOLDERS.map(folder => (
                  <SelectItem key={folder.value} value={folder.value}>
                    {folder.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={event => void handleUpload(event.target.files)}
            />
            <Button type="button" size="sm" className="gap-1.5" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </Button>
          </div>
        </div>

        <div className="grid gap-2 border-b border-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-7">
          {[
            ['Internal drafts', commandCounts.internal],
            ['Firm-shared PDFs', commandCounts.firmSharedPdfs],
            ['Client uploads', commandCounts.clientUploads],
            ['Portal uploads need review', commandCounts.portalUploadsNeedReview],
            ['Marker issues', commandCounts.markerIssues],
            ['Superseded', commandCounts.superseded],
            ['Versioned', commandCounts.versioned],
          ].map(([label, count]) => (
            <div key={label} className="rounded-md border border-border bg-muted/25 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold">{count}</p>
            </div>
          ))}
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

        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Folders</p>
              <p className="text-xs text-muted-foreground">Select a folder to see its documents.</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              Selected folder
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {folderSummaries.map(folder => {
              const selected = folder.value === activeFolder
              return (
                <button
                  key={folder.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveFolder(folder.value)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background hover:bg-muted/50',
                  )}
                >
                  <span className="block text-sm font-semibold">{folder.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{folder.description}</span>
                  <span className="mt-2 block text-lg font-semibold">
                    {folder.count}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      document{folder.count === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-2 border-b border-border px-4 py-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,180px)]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
              placeholder="Search documents"
            />
          </div>
          <Select value={visibilityFilter} onValueChange={value => setVisibilityFilter(value as VisibilityFilter)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visibility</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="firm-shared">Firm shared</SelectItem>
              <SelectItem value="client-upload">Client uploads</SelectItem>
              <SelectItem value="intake">Intake</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={value => setTypeFilter(value as FileTypeFilter)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="word">Word</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{activeFolderSummary?.label ?? documentFolderLabel(activeFolder)}</span>
          {activeFolderSummary?.description ? ` · ${activeFolderSummary.description}` : ''}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedDocuments.length === 0 || busy === 'bulk-download'} onClick={() => void handleDownloadSelected()}>
            {busy === 'bulk-download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download selected
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedDocuments.length === 0} onClick={() => setBulkMoveOpen(true)}>
            <FolderInput className="h-3.5 w-3.5" />
            Bulk move
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedEligibility.shareableIds.length === 0} onClick={() => beginShare(selectedDocuments)}>
            <Share2 className="h-3.5 w-3.5" />
            Share PDFs
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedEligibility.unshareableIds.length === 0 || busy === 'unshare'} onClick={() => void handleUnshare(selectedDocuments.filter(doc => selectedEligibility.unshareableIds.includes(doc.id)))}>
            <Undo2 className="h-3.5 w-3.5" />
            Unshare
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedCombinableDocs.length < 2} onClick={() => setCombineOpen(true)}>
            <Combine className="h-3.5 w-3.5" />
            Combine Word documents
          </Button>
          {selectedEligibility.blockedShareIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedEligibility.blockedShareIds.length} selected blocked from sharing.
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">
              {query.trim() || visibilityFilter !== 'all' || typeFilter !== 'all' ? 'No matching documents' : 'No documents in this folder'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {query.trim() || visibilityFilter !== 'all' || typeFilter !== 'all'
                ? 'Adjust the filters to see documents in this folder.'
                : 'Upload a file or move documents here to fill this folder.'}
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
                <TableHead>Folder</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.map(doc => {
                const shareEligibility = getDocumentShareEligibility(doc)
                const firmShared = classifyDocumentVisibility(doc) === 'firm-shared'
                return (
                  <TableRow key={doc.id} data-state={selectedIds.has(doc.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(doc.id)}
                        onCheckedChange={checked => toggleSelected(doc.id, checked === true)}
                        aria-label={`Select ${doc.name}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">{doc.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(doc.size)}
                            {doc.created_at ? ` · ${formatDateTime(doc.created_at)}` : ''}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        {documentFolderLabel(doc.folder)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <DocumentStatusBadges badges={buildDocumentStatusBadges(doc)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {isDocumentPdf(doc) && (
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setPreviewTarget(doc)}>
                            <FileSearch className="h-3.5 w-3.5" />
                            Preview PDF
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void openDocument(doc, 'view')}>
                          {busy === `view:${doc.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          View
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void openDocument(doc, 'download')}>
                          {busy === `download:${doc.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Download
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openRename(doc)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openMove(doc)}>
                          <FolderInput className="h-3.5 w-3.5" />
                          Move
                        </Button>
                        {!firmShared && (
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!shareEligibility.ok} title={shareEligibility.ok ? 'Share PDF' : shareEligibility.reason} onClick={() => beginShare([doc])}>
                            <Share2 className="h-3.5 w-3.5" />
                            Share PDF
                          </Button>
                        )}
                        {firmShared && (
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void handleUnshare([doc])}>
                            <Undo2 className="h-3.5 w-3.5" />
                            Unshare
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void openAudit(doc)}>
                          <History className="h-3.5 w-3.5" />
                          Audit
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs text-red-strong hover:bg-red-bg" onClick={() => setDeleteTarget(doc)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
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
            <DialogDescription>Update the display name shown in the matter file list.</DialogDescription>
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

      <Dialog open={moveTarget !== null} onOpenChange={open => !open && setMoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move document</DialogTitle>
            <DialogDescription>Choose a document folder. Firm-shared folders require PDFs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Folder</Label>
            <Select value={moveFolder} onValueChange={value => setMoveFolder(value as DocumentFolder)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_FOLDERS.map(folder => (
                  <SelectItem key={folder.value} value={folder.value}>
                    {folder.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{documentFolderDescription(moveFolder)}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!moveTarget || busy?.startsWith('move:')} onClick={() => void handleMove()}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk move</DialogTitle>
            <DialogDescription>Move selected documents to one folder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Folder</Label>
            <Select value={bulkMoveFolder} onValueChange={value => setBulkMoveFolder(value as DocumentFolder)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_FOLDERS.map(folder => (
                  <SelectItem key={folder.value} value={folder.value}>
                    {folder.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkMoveOpen(false)}>Cancel</Button>
            <Button type="button" disabled={selectedDocuments.length === 0 || busy === 'bulk-move'} onClick={() => void handleBulkMove()}>
              Move selected
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

      <PromoteDocumentDialog
        pending={pendingShareDoc ? { doc: pendingShareDoc, toFolder: pendingShareFolder } : null}
        onCancel={() => setPendingShareDocs([])}
        onConfirm={handleConfirmedShare}
      />

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

      <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Document audit</SheetTitle>
            <SheetDescription>{auditTarget?.name ?? 'Recent document history'}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {auditLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading audit history...
              </div>
            ) : auditEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent audit events.</p>
            ) : (
              auditEvents.map(event => (
                <div key={event.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium capitalize">{auditLabel(event)}</p>
                      <p className="text-xs text-muted-foreground">{event.user_email ?? 'Unknown user'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                  </div>
                  {Object.keys(event.metadata ?? {}).length > 0 && (
                    <pre className={cn('mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-[11px] text-muted-foreground')}>
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
