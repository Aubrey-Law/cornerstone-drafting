'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ,
  ChevronRight,
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
  SlidersHorizontal,
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CombineWordDraftsDialog } from '@/components/drafting/CombineWordDraftsDialog'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { DocumentStatusBadges } from '@/components/documents/DocumentStatusBadges'
import {
  DOCUMENT_FOLDERS,
  buildDocumentStatusBadges,
  documentFolderKey,
  documentFolderLabel,
  formatDocumentSize,
  isDocumentPdf,
  isDocumentShared,
  isDocumentWord,
  type DocumentFolderKey,
} from '@/lib/documentWorkspace'
import {
  deleteDocument,
  downloadDocumentsZip,
  getDocumentAuditEvents,
  getDocumentUrl,
  getDocumentViewerUrl,
  renameDocument,
  setDocumentReviewed,
  setDocumentShared,
  uploadDocument,
} from '@/lib/documents'
import { cn, formatDateTime } from '@/lib/utils'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { DocumentAccessAudit, MatterDocument } from '@/types/database'
import { documentDisplayTitle } from '@/lib/documentDisplayTitle'
import { useFileDrop } from '@/hooks/useFileDrop'
import { DocumentTypeIcon, FolderIcon } from './DocumentTypeIcon'

type Scope = 'all' | 'unreviewed' | 'shared' | 'client'
type SortKey = 'name' | 'date' | 'size'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  date: 'Date',
  size: 'Size',
}

/**
 * A client upload nobody has signed off on yet. Firm-generated documents are
 * never "unreviewed" in this sense — the badge is about incoming files.
 */
function isDocumentUnreviewed(doc: MatterDocument): boolean {
  return doc.source === 'client' && !doc.reviewed_at
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
  const [openFolder, setOpenFolder] = useState<DocumentFolderKey | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAscending, setSortAscending] = useState(true)
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
    setOpenFolder(null)
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
    unreviewed: visibleDocuments.filter(isDocumentUnreviewed).length,
    shared: visibleDocuments.filter(isDocumentShared).length,
    client: visibleDocuments.filter(doc => doc.source === 'client').length,
  }), [visibleDocuments])

  /** Scope + search, before the folder narrows the result any further. */
  const matchingDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return visibleDocuments.filter(doc => {
      if (scope === 'unreviewed' && !isDocumentUnreviewed(doc)) return false
      if (scope === 'shared' && !isDocumentShared(doc)) return false
      if (scope === 'client' && doc.source !== 'client') return false
      if (normalized && !doc.name.toLowerCase().includes(normalized)) return false
      return true
    })
  }, [query, scope, visibleDocuments])

  /** Folder tiles summarise what survived the scope and search, not the raw set. */
  const folders = useMemo(() => DOCUMENT_FOLDERS.map(folder => {
    const contents = matchingDocuments.filter(doc => documentFolderKey(doc) === folder.key)
    return {
      ...folder,
      documents: contents,
      size: contents.reduce((sum, doc) => sum + (doc.size || 0), 0),
    }
  }), [matchingDocuments])

  const sortDocuments = useCallback((docs: MatterDocument[]) => {
    const direction = sortAscending ? 1 : -1
    return [...docs].sort((a, b) => {
      if (sortKey === 'size') return direction * ((a.size || 0) - (b.size || 0))
      if (sortKey === 'date') return direction * (a.created_at ?? '').localeCompare(b.created_at ?? '')
      return direction * a.name.localeCompare(b.name)
    })
  }, [sortAscending, sortKey])

  /**
   * At the root every file is listed under the folder tiles, so the flat view
   * staff already rely on survives; opening a folder narrows to its contents.
   */
  const listedDocuments = useMemo(() => sortDocuments(
    openFolder === null
      ? matchingDocuments
      : matchingDocuments.filter(doc => documentFolderKey(doc) === openFolder),
  ), [matchingDocuments, openFolder, sortDocuments])

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
    listedDocuments.length > 0 && listedDocuments.every(doc => selectedIds.has(doc.id))

  const refresh = useCallback(async () => {
    await onDocumentsChanged()
  }, [onDocumentsChanged])

  const setSelection = (docs: MatterDocument[], checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const doc of docs) {
        if (checked) next.add(doc.id)
        else next.delete(doc.id)
      }
      return next
    })
  }

  const toggleSelected = (docId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(docId)
      else next.delete(docId)
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

  const handleUpload = useCallback(async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    setUploading(true)
    // Upload sequentially and count outcomes rather than failing the whole
    // batch on one bad file — a rejected scan shouldn't discard the others.
    let uploaded = 0
    try {
      for (const file of list) {
        try {
          await uploadDocument(file, matterId)
          uploaded += 1
        } catch (error) {
          toast.error(error instanceof Error ? `${file.name}: ${error.message}` : `Could not upload ${file.name}`)
        }
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? `Uploaded ${list[0].name}` : `Uploaded ${uploaded} documents`)
        await refresh()
      }
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }, [matterId, refresh])

  const { isDragging, dropProps } = useFileDrop(handleUpload, uploading)

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

  const handleMarkReviewed = async (doc: MatterDocument) => {
    setBusy(`review:${doc.id}`)
    try {
      await setDocumentReviewed(doc.id, true)
      toast.success(`Marked ${doc.name} reviewed`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark reviewed')
    } finally {
      setBusy(null)
    }
  }

  const scopes: Array<{ value: Scope; label: string; count: number }> = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'unreviewed', label: 'Unreviewed', count: counts.unreviewed },
    { value: 'shared', label: 'Shared', count: counts.shared },
    { value: 'client', label: 'From client', count: counts.client },
  ]
  const activeScope = scopes.find(option => option.value === scope) ?? scopes[0]

  return (
    <div className="space-y-4">
      <section
        {...dropProps}
        className={cn(
          'relative rounded-lg border border-border bg-card transition-colors',
          isDragging && 'border-primary ring-2 ring-inset ring-primary/40',
        )}
      >
        {isDragging && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-primary/5 backdrop-blur-[1px]"
          >
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-card px-4 py-2 text-sm font-medium shadow-sm">
              <Upload className="h-4 w-4 text-primary" />
              Drop files to upload
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {recordLabel === 'lead' ? 'Lead documents' : 'Matter documents'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Everything filed to this {recordLabel}. Drag files anywhere onto this panel, or use Upload. Flip the switch to show a document in the client portal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
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

        {/* Toolbar: select-all, search, filter, sort — the file-manager header row. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={checked => setSelection(listedDocuments, checked === true)}
            aria-label="Select all listed documents"
          />
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
              placeholder="Search for files and folders…"
              aria-label="Search documents"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeScope.label}
                <span className="tabular-nums">{activeScope.count}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show</DropdownMenuLabel>
              {scopes.map(option => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={scope === option.value}
                  onCheckedChange={() => setScope(option.value)}
                >
                  {option.label} <span className="ml-1 tabular-nums text-muted-foreground">{option.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <ArrowDownAZ className="h-3.5 w-3.5" />
                Sort: {SORT_LABELS[sortKey]} {sortAscending ? '↑' : '↓'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={sortKey === key}
                  onCheckedChange={() => setSortKey(key)}
                >
                  {SORT_LABELS[key]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSortAscending(value => !value)}>
                {sortAscending ? 'Descending' : 'Ascending'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {openFolder !== null && (
          <nav
            aria-label="Folder breadcrumb"
            className="flex items-center gap-1 border-b border-border px-4 py-2 text-xs"
          >
            <button
              type="button"
              className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={() => setOpenFolder(null)}
            >
              All documents
            </button>
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span aria-current="page" className="px-1.5 py-1 font-medium">
              {documentFolderLabel(openFolder)}
            </span>
          </nav>
        )}

        {selectedDocuments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {selectedDocuments.length} selected
            </span>
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
        ) : matchingDocuments.length === 0 ? (
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
          <ul className="divide-y divide-border">
            {openFolder === null && folders.map(folder => (
              <li key={folder.key}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                  <Checkbox
                    checked={folder.documents.length > 0
                      && folder.documents.every(doc => selectedIds.has(doc.id))}
                    disabled={folder.documents.length === 0}
                    onCheckedChange={checked => setSelection(folder.documents, checked === true)}
                    aria-label={`Select everything in ${folder.label}`}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default disabled:opacity-60"
                    disabled={folder.documents.length === 0}
                    onClick={() => setOpenFolder(folder.key)}
                  >
                    <FolderIcon />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{folder.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {folder.documents.length} item{folder.documents.length === 1 ? '' : 's'} · {folder.description}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
                      {formatDocumentSize(folder.size)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </div>
              </li>
            ))}

            {listedDocuments.map(doc => {
              const issues = (doc.marker_count ?? 0) + (doc.missing_count ?? 0)
              return (
                <li
                  key={doc.id}
                  id={`document-row-${doc.id}`}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-muted/30',
                    selectedIds.has(doc.id) && 'bg-muted/40',
                    highlightedDocumentId === doc.id && 'bg-amber-bg ring-1 ring-inset ring-amber-border',
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(doc.id)}
                    onCheckedChange={checked => toggleSelected(doc.id, checked === true)}
                    aria-label={`Select ${doc.name}`}
                  />
                  <DocumentTypeIcon name={doc.name} />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={doc.name}
                      aria-label={`${documentDisplayTitle(doc.name, clientName)}. Full filename: ${doc.name}`}
                    >
                      {documentDisplayTitle(doc.name, clientName)}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {openFolder === null && (
                        <span className="text-[11px] text-muted-foreground">
                          {documentFolderLabel(documentFolderKey(doc))}
                        </span>
                      )}
                      <DocumentStatusBadges badges={buildDocumentStatusBadges(doc).slice(0, 2)} />
                      {isDocumentUnreviewed(doc) && (
                        <Badge
                          variant="outline"
                          className="border-amber-border bg-amber-bg text-[10px] text-amber"
                        >
                          Unreviewed
                        </Badge>
                      )}
                      {issues > 0 && (
                        <span className="text-xs font-medium text-amber">
                          {issues} issue{issues === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground lg:block">
                    {doc.created_at ? formatDateTime(doc.created_at) : '—'}
                  </span>
                  <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                    {formatDocumentSize(doc.size)}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {doc.source === 'client' ? 'Client' : 'Firm'}
                  </Badge>
                  <Switch
                    checked={isDocumentShared(doc)}
                    disabled={busy === 'share' || busy === 'unshare'}
                    onCheckedChange={checked => void handleShare([doc], checked)}
                    aria-label={`Share ${doc.name} with the client`}
                  />

                  <div className="flex shrink-0 items-center gap-1">
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
                        {isDocumentUnreviewed(doc) && (
                          <DropdownMenuItem
                            disabled={busy === `review:${doc.id}`}
                            onSelect={() => void handleMarkReviewed(doc)}
                          >
                            <Eye className="mr-2 h-4 w-4" />Mark reviewed
                          </DropdownMenuItem>
                        )}
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
                </li>
              )
            })}

            {listedDocuments.length === 0 && (
              <li className="px-6 py-10 text-center text-sm text-muted-foreground">
                This folder is empty in the current view.
              </li>
            )}
          </ul>
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
