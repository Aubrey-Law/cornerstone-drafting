'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Download,
  Eye,
  FileText,
  FolderInput,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Label } from '@/components/ui/label'
import {
  deleteDocument,
  downloadDocumentsZip,
  getDocumentUrl,
  getDocumentViewerUrl,
  isPdfDocument,
  renameDocument,
  updateDocumentFolder,
  uploadDocument,
} from '@/lib/documents'
import { isFirmSharedFolder, wordDocShareBlockReason } from '@/lib/documentSharing'
import { cn, formatDate } from '@/lib/utils'
import type { MatterDocument } from '@/types/database'

type FolderValue = MatterDocument['folder']
type VisibilityFilter = 'all' | 'internal' | 'client-visible'
type FileTypeFilter = 'all' | 'pdf' | 'word' | 'other'

const FOLDER_OPTIONS: Array<{ value: FolderValue; label: string; description: string }> = [
  { value: 'draft', label: 'Internal draft', description: 'Attorney work product, hidden from client' },
  { value: 'review', label: 'Client review PDF', description: 'Client visible after attorney review' },
  { value: 'final', label: 'Final PDF', description: 'Client visible final document' },
  { value: 'signed', label: 'Signed PDF', description: 'Client visible executed document' },
  { value: 'client', label: 'Client upload', description: 'Client-provided document' },
  { value: 'intake', label: 'Intake', description: 'Intake source or support file' },
  { value: 'meeting-notes', label: 'Meeting notes', description: 'Internal meeting notes' },
]

const INTERNAL_FOLDERS = new Set<FolderValue>(['draft', 'meeting-notes'])

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function folderLabel(folder: FolderValue) {
  return FOLDER_OPTIONS.find(option => option.value === folder)?.label ?? folder
}

function fileType(doc: MatterDocument): FileTypeFilter {
  const name = doc.name.toLowerCase()
  if (isPdfDocument(doc.name, doc.content_type)) return 'pdf'
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'word'
  return 'other'
}

function isClientVisible(doc: MatterDocument) {
  return !INTERNAL_FOLDERS.has(doc.folder)
}

function statusBadges(doc: MatterDocument) {
  const markerCount = doc.marker_count ?? 0
  const badges: Array<{ label: string; className: string }> = []

  if (isClientVisible(doc)) {
    badges.push({ label: 'Client visible', className: 'border-green/30 text-green' })
  } else {
    badges.push({ label: 'Internal', className: 'text-muted-foreground' })
  }
  if (doc.reviewed_at) badges.push({ label: 'Reviewed', className: 'border-success/30 text-success' })
  if (markerCount > 0) badges.push({ label: 'Markers', className: 'border-destructive/30 text-destructive' })
  if (doc.superseded_at) badges.push({ label: 'Superseded', className: 'border-amber-border bg-amber-bg text-amber' })

  return badges
}

interface MatterDocumentsTabProps {
  matterId: string
  documents: MatterDocument[]
  loading: boolean
  onDocumentsChanged: () => void | Promise<void>
}

export function MatterDocumentsTab({
  matterId,
  documents,
  loading,
  onDocumentsChanged,
}: MatterDocumentsTabProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState<FolderValue | 'all'>('all')
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all')
  const [uploadFolder, setUploadFolder] = useState<FolderValue>('client')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<MatterDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<MatterDocument | null>(null)
  const [moveFolder, setMoveFolder] = useState<FolderValue>('draft')
  const [deleteTarget, setDeleteTarget] = useState<MatterDocument | null>(null)

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return documents.filter(doc => {
      if (normalized && !doc.name.toLowerCase().includes(normalized)) return false
      if (folderFilter !== 'all' && doc.folder !== folderFilter) return false
      if (visibilityFilter === 'internal' && isClientVisible(doc)) return false
      if (visibilityFilter === 'client-visible' && !isClientVisible(doc)) return false
      if (typeFilter !== 'all' && fileType(doc) !== typeFilter) return false
      return true
    })
  }, [documents, folderFilter, query, typeFilter, visibilityFilter])

  const selectedDocuments = useMemo(
    () => documents.filter(doc => selectedIds.has(doc.id)),
    [documents, selectedIds],
  )

  const allVisibleSelected = filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedIds.has(doc.id))

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

  const handleMove = async () => {
    const doc = moveTarget
    if (!doc) return
    const blockReason = wordDocShareBlockReason(doc.name, doc.content_type, moveFolder)
    if (blockReason) {
      toast.error(blockReason)
      return
    }
    setBusy(`move:${doc.id}`)
    try {
      await updateDocumentFolder(doc.id, moveFolder, { confirmed: isFirmSharedFolder(moveFolder) })
      toast.success(`Moved to ${folderLabel(moveFolder)}`)
      setMoveTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move document')
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
            <Select value={uploadFolder} onValueChange={value => setUploadFolder(value as FolderValue)}>
              <SelectTrigger size="sm" className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDER_OPTIONS.map(folder => (
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={selectedDocuments.length === 0 || busy === 'bulk-download'}
              onClick={() => void handleDownloadSelected()}
            >
              {busy === 'bulk-download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download selected
            </Button>
          </div>
        </div>

        <div className="grid gap-2 border-b border-border px-4 py-3 md:grid-cols-[minmax(220px,1fr)_repeat(3,180px)]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
              placeholder="Search documents"
            />
          </div>
          <Select value={folderFilter} onValueChange={value => setFolderFilter(value as FolderValue | 'all')}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Folder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All folders</SelectItem>
              {FOLDER_OPTIONS.map(folder => (
                <SelectItem key={folder.value} value={folder.value}>
                  {folder.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={visibilityFilter} onValueChange={value => setVisibilityFilter(value as VisibilityFilter)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visibility</SelectItem>
              <SelectItem value="internal">Internal only</SelectItem>
              <SelectItem value="client-visible">Client visible</SelectItem>
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

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No matching documents</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a file or adjust the filters to see matter documents.
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
              {filteredDocuments.map(doc => (
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
                          {doc.created_at ? ` · ${formatDate(doc.created_at)}` : ''}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[11px]">
                      {folderLabel(doc.folder)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-1.5">
                      {statusBadges(doc).map(badge => (
                        <Badge key={badge.label} variant="outline" className={cn('text-[11px]', badge.className)}>
                          {badge.label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
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
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-xs text-red-strong hover:bg-red-bg"
                        onClick={() => setDeleteTarget(doc)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
            <DialogDescription>
              Choose a document folder. Client-visible firm folders require PDF files.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Folder</Label>
            <Select value={moveFolder} onValueChange={value => setMoveFolder(value as FolderValue)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDER_OPTIONS.map(folder => (
                  <SelectItem key={folder.value} value={folder.value}>
                    {folder.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {moveTarget && wordDocShareBlockReason(moveTarget.name, moveTarget.content_type, moveFolder) ? (
              <p className="text-xs text-destructive">
                {wordDocShareBlockReason(moveTarget.name, moveTarget.content_type, moveFolder)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {FOLDER_OPTIONS.find(folder => folder.value === moveFolder)?.description}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveTarget(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!moveTarget || busy?.startsWith('move:') || Boolean(moveTarget && wordDocShareBlockReason(moveTarget.name, moveTarget.content_type, moveFolder))}
              onClick={() => void handleMove()}
            >
              Move
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
    </div>
  )
}
