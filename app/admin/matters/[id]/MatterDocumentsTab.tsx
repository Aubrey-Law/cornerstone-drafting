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
  Folder,
  FolderPlus,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenLine,
  Send,
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
import { SendForSignatureDialog } from './SendForSignatureDialog'
import { PriorPlansPanel } from './PriorPlansPanel'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { DocumentStatusBadges } from '@/components/documents/DocumentStatusBadges'
import {
  buildDocumentStatusBadges,
  documentFolderId,
  documentFolderViews,
  formatDocumentSize,
  isDocumentPdf,
  isDocumentShared,
  isDocumentWord,
  resolveFolderLabel,
} from '@/lib/documentWorkspace'
import { MAX_FOLDER_NAME_LENGTH, normalizeFolderName } from '@/lib/documentFolders'
import {
  createDocumentFolder,
  deleteDocument,
  deleteDocumentFolder,
  downloadDocumentsZip,
  getDocumentAuditEvents,
  getDocumentUrl,
  isWordDocument,
  moveDocumentToFolder,
  renameDocument,
  renameDocumentFolder,
  setDocumentReviewed,
  setDocumentShared,
  uploadDocument,
  cancelSignatureRequest,
  resendSignatureRequest,
} from '@/lib/documents'
import { isRequestLive, SIGNATURE_REQUEST_LABELS } from '@/lib/esign/requestStatus'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import { cn, formatDateTime } from '@/lib/utils'
import { formatFirmDate } from '@/lib/format'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { DocumentAccessAudit, MatterDocument, MatterDocumentFolder } from '@/types/database'
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

/**
 * How a signing badge reads. A completed request keeps its badge rather than
 * disappearing: the executed copy arrives as a separate document, so without it
 * the row an attorney sent from would look untouched.
 */
const SIGNATURE_BADGE_TONE: Record<string, string> = {
  signed: 'border-green/30 bg-green-bg text-green',
  failed: 'border-destructive/40 text-destructive',
  declined: 'border-destructive/40 text-destructive',
  expired: 'border-amber-border bg-amber-bg text-amber',
  cancelled: 'text-muted-foreground',
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
  /** Attorney-created folders. Derived folders come from the documents themselves. */
  folders?: MatterDocumentFolder[]
  loading: boolean
  loadError?: string | null
  onDocumentsChanged: () => void | Promise<void>
  unreviewedUploadCounts?: UnreviewedUploadCounts
  onReviewPortalUploads?: () => void | Promise<void>
  onReviewIntakeUploads?: () => void | Promise<void>
  clientName?: string | null
  deepLinkedDocumentId?: string | null
  initialScope?: Scope
  onScopeChange?: (scope: Scope) => void
  recordLabel?: 'matter' | 'lead'
  /** firm_settings.esign_documents_enabled. Off hides the action entirely. */
  esignDocumentsEnabled?: boolean
  /** What this record already has out for signature, newest first. */
  signatureRequests?: SignatureRequestSummary[]
  /** Prefills the first signer row. The client, usually. */
  defaultSigner?: { name: string; email: string } | null
}

export function MatterDocumentsTab({
  matterId,
  documents,
  folders: customFolders = [],
  loading,
  loadError = null,
  onDocumentsChanged,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  onReviewPortalUploads,
  onReviewIntakeUploads,
  clientName,
  deepLinkedDocumentId,
  initialScope = 'all',
  onScopeChange,
  recordLabel = 'matter',
  esignDocumentsEnabled = false,
  signatureRequests = [],
  defaultSigner = null,
}: MatterDocumentsTabProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>(initialScope)
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAscending, setSortAscending] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<MatterDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /** One document from a row menu, or the whole selection from the toolbar. */
  const [deleteTargets, setDeleteTargets] = useState<MatterDocument[]>([])
  const [previewTarget, setPreviewTarget] = useState<MatterDocument | null>(null)
  const [viewedRevisions, setViewedRevisions] = useState<Record<string, string | null>>({})
  const [combineOpen, setCombineOpen] = useState(false)
  const [auditTarget, setAuditTarget] = useState<MatterDocument | null>(null)
  const [auditEvents, setAuditEvents] = useState<DocumentAccessAudit[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderRenameTarget, setFolderRenameTarget] = useState<MatterDocumentFolder | null>(null)
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<MatterDocumentFolder | null>(null)
  const [signatureTarget, setSignatureTarget] = useState<MatterDocument | null>(null)
  const [cancelTarget, setCancelTarget] = useState<SignatureRequestSummary | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  useEffect(() => {
    if (!deepLinkedDocumentId) {
      setScope(initialScope)
      if (initialScope === 'unreviewed') setOpenFolder(null)
    }
  }, [initialScope, deepLinkedDocumentId])

  useEffect(() => {
    if (!deepLinkedDocumentId) return
    const target = documents.find(candidate => candidate.id === deepLinkedDocumentId)
    if (!target) return
    setScope('all')
    setQuery('')
    // Open the folder that holds the target, otherwise the row we are about to
    // scroll to is not on screen — loose files sit at the root.
    setOpenFolder(documentFolderId(target))
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

  /**
   * The newest request per source document. A document can be sent more than
   * once — nothing server-side prevents it — and the latest is the one whose
   * links are live.
   */
  const requestByDocument = useMemo(() => {
    const map = new Map<string, SignatureRequestSummary>()
    for (const request of signatureRequests) {
      if (request.sourceDocumentId && !map.has(request.sourceDocumentId)) {
        map.set(request.sourceDocumentId, request)
      }
    }
    return map
  }, [signatureRequests])

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

  /**
   * Folder tiles summarise what survived the scope and search, not the raw set.
   * Attorney-created folders are listed even when empty — one you just made and
   * have not filed anything into yet still has to be visible to drop files on.
   */
  const folders = useMemo(() => documentFolderViews(customFolders).map(folder => {
    const contents = matchingDocuments.filter(doc => documentFolderId(doc) === folder.id)
    return {
      ...folder,
      documents: contents,
      size: contents.reduce((sum, doc) => sum + (doc.size || 0), 0),
    }
  }), [customFolders, matchingDocuments])

  const sortDocuments = useCallback((docs: MatterDocument[]) => {
    const direction = sortAscending ? 1 : -1
    return [...docs].sort((a, b) => {
      if (sortKey === 'size') return direction * ((a.size || 0) - (b.size || 0))
      if (sortKey === 'date') return direction * (a.created_at ?? '').localeCompare(b.created_at ?? '')
      // Rows show the tidied title ("Pour Over Will"), not the raw filename
      // ("Jordan Client Pour-Over Will.docx"); sorting the raw name put them
      // in an order the list could not explain.
      return direction * documentDisplayTitle(a.name, clientName).localeCompare(documentDisplayTitle(b.name, clientName))
    })
  }, [clientName, sortAscending, sortKey])

  const searching = query.trim().length > 0 || scope === 'unreviewed'

  /**
   * The root lists the folder tiles plus only the files that live in none of
   * them, so nothing is shown twice; opening a folder narrows to its contents.
   * A search is the exception — it flattens across folders the way a file
   * manager does, so a match inside one is a result rather than a count.
   */
  const listedDocuments = useMemo(() => {
    if (openFolder !== null) {
      return sortDocuments(matchingDocuments.filter(doc => documentFolderId(doc) === openFolder))
    }
    if (searching) return sortDocuments(matchingDocuments)
    return sortDocuments(matchingDocuments.filter(doc => documentFolderId(doc) === null))
  }, [matchingDocuments, openFolder, searching, sortDocuments])

  /** Folder tiles are root furniture; a flattened search replaces them. */
  const showFolders = openFolder === null && !searching

  /**
   * At the root the master checkbox covers the folders on screen as well, not
   * just the loose files sitting beside them.
   */
  const selectAllTargets = openFolder === null && !searching ? matchingDocuments : listedDocuments

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
    selectAllTargets.length > 0 && selectAllTargets.every(doc => selectedIds.has(doc.id))

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
    // Word documents are previewed in-app. Opening a signed R2 URL in a tab is
    // fine for a PDF the browser renders itself, but a Word file would need an
    // external viewer to display it — which is how client instruments used to
    // reach Microsoft's Office Online service.
    if (action === 'view' && isWordDocument(doc.name, doc.content_type)) {
      setPreviewTarget(doc)
      return
    }
    setBusy(`${action}:${doc.id}`)
    try {
      const url = action === 'view'
        ? await getDocumentUrl(doc.id, 'view')
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

    // Per document rather than one try around the loop. Sharing is now gated on
    // unfilled generator fields, so one document in a selection being refused
    // is an ordinary outcome — and aborting the batch on it would silently
    // leave the rest unshared with no indication which ones.
    const failures: string[] = []
    let done = 0
    for (const doc of docs) {
      try {
        await setDocumentShared(doc.id, shared)
        done += 1
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Could not update ${doc.name}`)
      }
    }

    const verb = shared ? 'Shared' : 'Unshared'
    if (done > 0) toast.success(`${verb} ${done} document${done === 1 ? '' : 's'}`)
    for (const failure of failures) toast.error(failure)
    await refresh()
    setBusy(null)
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
    // A file dropped while a folder is open belongs in that folder — anything
    // else makes the attorney go find it again at the root. Only attorney-made
    // folders can hold a document; the derived three are computed.
    const destinationFolder = customFolders.some(folder => folder.id === openFolder)
      ? openFolder
      : null
    // Upload sequentially and count outcomes rather than failing the whole
    // batch on one bad file — a rejected scan shouldn't discard the others.
    let uploaded = 0
    try {
      for (const file of list) {
        try {
          const created = await uploadDocument(file, matterId)
          if (destinationFolder) {
            // A failed move still leaves the file uploaded — it just lands
            // at the root instead of inside the open folder.
            await moveDocumentToFolder(created.id, destinationFolder).catch(() => {})
          }
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
  }, [customFolders, matterId, openFolder, refresh])

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
    const targets = deleteTargets
    if (targets.length === 0) return
    setBusy('delete')
    // Delete one at a time and count outcomes rather than abandoning the batch
    // on the first refusal — the same rule the upload loop follows.
    const deleted: string[] = []
    try {
      for (const doc of targets) {
        try {
          await deleteDocument(doc.id)
          deleted.push(doc.id)
        } catch (error) {
          toast.error(error instanceof Error ? `${doc.name}: ${error.message}` : `Could not delete ${doc.name}`)
        }
      }
      if (deleted.length > 0) {
        setSelectedIds(prev => {
          const next = new Set(prev)
          for (const id of deleted) next.delete(id)
          return next
        })
        toast.success(deleted.length === 1 ? 'Document deleted' : `Deleted ${deleted.length} documents`)
        await refresh()
      }
    } finally {
      setBusy(null)
      setDeleteTargets([])
    }
  }

  const handleCreateFolder = async () => {
    const name = normalizeFolderName(newFolderName)
    if (!name) return
    setBusy('create-folder')
    try {
      const folder = await createDocumentFolder(matterId, name)
      toast.success(`Created “${folder.name}”`)
      setNewFolderOpen(false)
      setNewFolderName('')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create folder')
    } finally {
      setBusy(null)
    }
  }

  const handleRenameFolder = async () => {
    const folder = folderRenameTarget
    const name = normalizeFolderName(folderRenameValue)
    if (!folder || !name) return
    setBusy('rename-folder')
    try {
      await renameDocumentFolder(folder.id, name)
      toast.success('Folder renamed')
      setFolderRenameTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename folder')
    } finally {
      setBusy(null)
    }
  }

  const handleDeleteFolder = async () => {
    const folder = folderDeleteTarget
    if (!folder) return
    setBusy('delete-folder')
    try {
      await deleteDocumentFolder(folder.id)
      // Its documents survive; the view they were in does not.
      if (openFolder === folder.id) setOpenFolder(null)
      toast.success(`Deleted “${folder.name}”. Its documents moved back to All documents.`)
      setFolderDeleteTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete folder')
    } finally {
      setBusy(null)
    }
  }

  /** File documents into a folder, or pass null to send them back to the root. */
  const handleMove = async (docs: MatterDocument[], folderId: string | null) => {
    if (docs.length === 0) return
    setBusy('move')
    const moved: string[] = []
    try {
      for (const doc of docs) {
        try {
          await moveDocumentToFolder(doc.id, folderId)
          moved.push(doc.id)
        } catch (error) {
          toast.error(error instanceof Error ? `${doc.name}: ${error.message}` : `Could not move ${doc.name}`)
        }
      }
      if (moved.length > 0) {
        const destination = folderId
          ? resolveFolderLabel(folderId, customFolders)
          : 'All documents'
        toast.success(moved.length === 1 ? `Moved to ${destination}` : `Moved ${moved.length} documents to ${destination}`)
        await refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  const handleCancelSignature = async () => {
    const request = cancelTarget
    const reason = cancelReason.trim()
    if (!request || !reason) return
    setBusy('cancel-signature')
    try {
      await cancelSignatureRequest(matterId, request.id, reason)
      toast.success('Signature request withdrawn')
      setCancelTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not withdraw this request')
    } finally {
      setBusy(null)
    }
  }

  const handleResendSignature = async (request: SignatureRequestSummary, recipientKey: string) => {
    setBusy(`resend:${recipientKey}`)
    try {
      const { email } = await resendSignatureRequest(matterId, request.id, recipientKey, 168)
      toast.success(`New link sent to ${email}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send a new link')
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
      await setDocumentReviewed(doc.id, true, viewedRevisions[doc.id] ?? undefined)
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
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-primary/5"
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
              Drag files onto this panel or use Upload. Turn on Portal to share a file with the client.
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
              variant="outline"
              className="gap-1.5"
              onClick={() => { setNewFolderName(''); setNewFolderOpen(true) }}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </Button>
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

        {recordLabel === 'matter' && <PriorPlansPanel matterId={matterId} onFiled={refresh} />}

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

        {/* Toolbar: select-all, search, filter, sort — the file-manager header row.
            On a phone the search takes the first line and the rest share the
            second, rather than Sort wrapping onto a line of its own. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={checked => setSelection(selectAllTargets, checked === true)}
            aria-label="Select all listed documents"
          />
          <div className="relative order-first w-full sm:order-none sm:w-auto sm:min-w-[12rem] sm:flex-1">
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
                  onCheckedChange={() => {
                    setScope(option.value)
                    if (option.value === 'unreviewed') setOpenFolder(null)
                    onScopeChange?.(option.value)
                  }}
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
              className="rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setOpenFolder(null)}
            >
              All documents
            </button>
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span aria-current="page" className="px-1.5 py-1 font-medium">
              {resolveFolderLabel(openFolder, customFolders)}
            </span>
          </nav>
        )}

        {selectedDocuments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {selectedDocuments.length} selected
            </span>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'bulk-download'} onClick={() => void handleDownloadSelected()}>
              {busy === 'bulk-download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download selected
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'share' || selectedDocuments.every(isDocumentShared)} onClick={() => void handleShare(selectedDocuments.filter(doc => !isDocumentShared(doc)), true)}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'unshare' || !selectedDocuments.some(isDocumentShared)} onClick={() => void handleShare(selectedDocuments.filter(isDocumentShared), false)}>
              <Undo2 className="h-3.5 w-3.5" />
              Unshare
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedCombinableDocs.length < 2} onClick={() => setCombineOpen(true)}>
              <Combine className="h-3.5 w-3.5" />
              Combine Word documents
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'move'}>
                  {busy === 'move' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                  Move to
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                {customFolders.length === 0 ? (
                  <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                ) : (
                  customFolders.map(folder => (
                    <DropdownMenuItem
                      key={folder.id}
                      onSelect={() => void handleMove(selectedDocuments, folder.id)}
                    >
                      {folder.name}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleMove(selectedDocuments, null)}>
                  All documents (no folder)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={busy === 'delete'}
              onClick={() => setDeleteTargets(selectedDocuments)}
            >
              {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete selected
            </Button>
          </div>
        )}

        {loadError && documents.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Documents are currently unavailable.</p>
        ) : loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : matchingDocuments.length === 0 && (!showFolders || customFolders.length === 0) ? (
          // Empty folders are still worth drawing, so the empty state only
          // takes over when there would be nothing on screen at all.
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
            {showFolders && folders.map(folder => (
              <li key={folder.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
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
                    disabled={!folder.custom && folder.documents.length === 0}
                    onClick={() => setOpenFolder(folder.id)}
                  >
                    <FolderIcon />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{folder.label}</span>
                      <span className="block truncate text-micro text-muted-foreground">
                        {folder.documents.length} item{folder.documents.length === 1 ? '' : 's'} · {folder.description}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
                      {formatDocumentSize(folder.size)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                  {/* Only an attorney-created folder can be renamed or removed:
                      the derived three are computed, with nothing to edit. */}
                  {folder.custom && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`Actions for folder ${folder.label}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            const row = customFolders.find(candidate => candidate.id === folder.id)
                            if (!row) return
                            setFolderRenameTarget(row)
                            setFolderRenameValue(row.name)
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />Rename folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => {
                            const row = customFolders.find(candidate => candidate.id === folder.id)
                            if (row) setFolderDeleteTarget(row)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />Delete folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* Holds the menu's slot so every folder's chevron lines up. */}
                  {!folder.custom && <span aria-hidden className="h-8 w-8 shrink-0" />}
                </div>
              </li>
            ))}

            {listedDocuments.map(doc => {
              const issues = (doc.marker_count ?? 0) + (doc.missing_count ?? 0)
              const folderKey = documentFolderId(doc)
              const signatureRequest = requestByDocument.get(doc.id) ?? null
              return (
                <li
                  key={doc.id}
                  id={`document-row-${doc.id}`}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 hover:bg-accent',
                    selectedIds.has(doc.id) && 'bg-muted',
                    highlightedDocumentId === doc.id && 'bg-amber-bg ring-1 ring-inset ring-amber-border',
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(doc.id)}
                    onCheckedChange={checked => toggleSelected(doc.id, checked === true)}
                    aria-label={`Select ${doc.name}`}
                  />
                  <DocumentTypeIcon name={doc.name} />
                  {/* The floor keeps the name readable on a phone: below it the
                      row's controls wrap to a second line instead of squeezing
                      the title down to three letters. */}
                  <div className="min-w-[12rem] flex-1">
                    <p
                      className="line-clamp-2 break-words text-sm font-medium sm:line-clamp-none sm:truncate"
                      title={doc.name}
                      aria-label={`${documentDisplayTitle(doc.name, clientName)}. Full filename: ${doc.name}`}
                    >
                      {documentDisplayTitle(doc.name, clientName)}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {/* The date and size columns are hidden below lg and sm;
                          there they ride on this line so a sort by date or
                          size still shows what it sorted by. */}
                      <span className="text-micro tabular-nums text-muted-foreground lg:hidden">
                        {doc.created_at ? formatFirmDate(doc.created_at) : '—'}
                        <span className="sm:hidden"> · {formatDocumentSize(doc.size)}</span>
                      </span>
                      {/* Only a search puts foldered files in this list, and
                          there the chip is what says where the hit lives. */}
                      {openFolder === null && folderKey !== null && (
                        <span className="text-micro text-muted-foreground">
                          {resolveFolderLabel(folderKey, customFolders)}
                        </span>
                      )}
                      <DocumentStatusBadges badges={buildDocumentStatusBadges(doc).slice(0, 2)} />
                      {/* Rendered beside that list rather than through it: the
                          row slices the computed badges to two, so a signing
                          state added there would vanish on most documents. */}
                      {signatureRequest && (
                        <Badge
                          variant="outline"
                          className={cn('text-micro', SIGNATURE_BADGE_TONE[signatureRequest.state])}
                          title={signatureRequest.error ?? undefined}
                        >
                          {SIGNATURE_REQUEST_LABELS[signatureRequest.state]}
                          {signatureRequest.state === 'partially_signed'
                            && ` ${signatureRequest.signedCount}/${signatureRequest.signerCount}`}
                        </Badge>
                      )}
                      {isDocumentUnreviewed(doc) && (
                        <Badge
                          variant="outline"
                          className="border-amber-border bg-amber-bg text-micro text-amber"
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
                  {/* Firm files are the default; only a client upload is worth a badge. */}
                  {doc.source === 'client' && (
                    <Badge variant="outline" className="ml-auto shrink-0 text-micro sm:ml-0">
                      Client
                    </Badge>
                  )}
                  <label className={cn('flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground', doc.source !== 'client' && 'ml-auto sm:ml-0')}>
                    <Switch
                      checked={isDocumentShared(doc)}
                      disabled={busy === 'share' || busy === 'unshare'}
                      onCheckedChange={checked => void handleShare([doc], checked)}
                      aria-label={`Share ${doc.name} with the client`}
                    />
                    Portal
                  </label>

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
                            disabled={busy === `review:${doc.id}` || !viewedRevisions[doc.id]}
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
                        {esignDocumentsEnabled && isDocumentPdf(doc) && (
                          <DropdownMenuItem onSelect={() => setSignatureTarget(doc)}>
                            <PenLine className="mr-2 h-4 w-4" />Send for signature
                          </DropdownMenuItem>
                        )}
                        {esignDocumentsEnabled && isRequestLive(signatureRequest) && (
                          <DropdownMenuItem
                            onSelect={() => { setCancelReason(''); setCancelTarget(signatureRequest) }}
                          >
                            <Undo2 className="mr-2 h-4 w-4" />Withdraw signature request
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => void openDocument(doc, 'download')}>
                          <Download className="mr-2 h-4 w-4" />Download
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { setRenameTarget(doc); setRenameValue(doc.name) }}>
                          <Pencil className="mr-2 h-4 w-4" />Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
                          Move to folder
                        </DropdownMenuLabel>
                        {customFolders.length === 0 ? (
                          <DropdownMenuItem
                            onSelect={() => { setNewFolderName(''); setNewFolderOpen(true) }}
                          >
                            <FolderPlus className="mr-2 h-4 w-4" />New folder…
                          </DropdownMenuItem>
                        ) : (
                          customFolders
                            .filter(folder => folder.id !== doc.folder_id)
                            .map(folder => (
                              <DropdownMenuItem
                                key={folder.id}
                                onSelect={() => void handleMove([doc], folder.id)}
                              >
                                <Folder className="mr-2 h-4 w-4" />
                                <span className="truncate">{folder.name}</span>
                              </DropdownMenuItem>
                            ))
                        )}
                        {doc.folder_id && (
                          <DropdownMenuItem onSelect={() => void handleMove([doc], null)}>
                            <Undo2 className="mr-2 h-4 w-4" />Remove from folder
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void openAudit(doc)}>
                          <History className="mr-2 h-4 w-4" />History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTargets([doc])}>
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              )
            })}

            {listedDocuments.length === 0 && openFolder !== null && (
              <li className="px-6 py-10 text-center text-sm text-muted-foreground">
                This folder is empty in the current view.
              </li>
            )}
          </ul>
        )}
      </section>

      <Dialog open={newFolderOpen} onOpenChange={open => { if (!open) setNewFolderOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Group this {recordLabel}&rsquo;s documents however the work is organised. Folders are
              firm-only — the client portal never shows them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              value={newFolderName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              placeholder="Deed work"
              onChange={event => setNewFolderName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateFolder()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={!normalizeFolderName(newFolderName) || busy === 'create-folder'}
              onClick={() => void handleCreateFolder()}
            >
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderRenameTarget !== null} onOpenChange={open => !open && setFolderRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>The documents inside stay where they are.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={folderRenameValue}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={event => setFolderRenameValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFolderRenameTarget(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!normalizeFolderName(folderRenameValue) || busy === 'rename-folder'}
              onClick={() => void handleRenameFolder()}
            >
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={folderDeleteTarget !== null} onOpenChange={open => !open && setFolderDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{folderDeleteTarget?.name ?? ''}&rdquo; will be removed. The documents filed in it are
              not deleted — they move back to All documents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy === 'delete-folder'} onClick={() => void handleDeleteFolder()}>
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={deleteTargets.length > 0} onOpenChange={open => !open && setDeleteTargets([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets.length > 1 ? `Delete ${deleteTargets.length} documents?` : 'Delete document?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets.length > 1
                ? `All ${deleteTargets.length} selected documents will be permanently deleted. This cannot be undone.`
                : `“${deleteTargets[0]?.name ?? ''}” will be permanently deleted. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Nothing here is recoverable, so the list names every file going. */}
          {deleteTargets.length > 1 && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              {deleteTargets.map(doc => (
                <li key={doc.id} className="truncate" title={doc.name}>{doc.name}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy === 'delete'} onClick={() => void handleDelete()}>
              {deleteTargets.length > 1 ? `Delete ${deleteTargets.length} documents` : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        document={previewTarget}
        open={previewTarget !== null}
        onOpenChange={open => !open && setPreviewTarget(null)}
        onRevisionLoaded={(id, revision) => setViewedRevisions(prev => ({ ...prev, [id]: revision }))}
      />

      <AlertDialog open={cancelTarget !== null} onOpenChange={open => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this signature request?</AlertDialogTitle>
            <AlertDialogDescription>
              Every link already sent for &ldquo;{cancelTarget?.name ?? ''}&rdquo; stops working
              immediately, and anyone who opens one is told the firm withdrew it. This cannot be
              undone — getting the document signed afterwards means sending it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* A signature already given is not unmade by withdrawing the
              request, and whoever is about to do this should know it happened. */}
          {(cancelTarget?.signedCount ?? 0) > 0 && (
            <p role="alert" className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
              {cancelTarget?.signers.filter(signer => signer.signedAt).map(signer => signer.name).join(', ')}
              {' '}already signed. That signature stays on the record; the document simply never completes.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="withdraw-reason">Why is it being withdrawn?</Label>
            <Input
              id="withdraw-reason"
              value={cancelReason}
              placeholder="Wrong version sent"
              onChange={event => setCancelReason(event.target.value)}
            />
            <p className="text-micro text-muted-foreground">
              Recorded on the audit trail, and printed on the certificate of anything signed from
              this request.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              disabled={!cancelReason.trim() || busy === 'cancel-signature'}
              onClick={event => { event.preventDefault(); void handleCancelSignature() }}
            >
              Withdraw request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendForSignatureDialog
        matterId={matterId}
        document={signatureTarget}
        defaultSigner={defaultSigner}
        existingRequest={signatureTarget ? requestByDocument.get(signatureTarget.id) ?? null : null}
        onOpenChange={open => !open && setSignatureTarget(null)}
        onSent={refresh}
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
            {/* Signing first: when a document is out for signature, who has and
                has not signed is the thing being looked for. */}
            {auditTarget && requestByDocument.get(auditTarget.id) && (() => {
              const request = requestByDocument.get(auditTarget.id)!
              return (
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">
                      {SIGNATURE_REQUEST_LABELS[request.state]}
                      {request.signerCount > 0 && ` · ${request.signedCount} of ${request.signerCount} signed`}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {request.sentAt ? formatDateTime(request.sentAt) : '—'}
                    </span>
                  </div>
                  {request.error && (
                    <p className="mt-1 text-xs text-destructive">{request.error}</p>
                  )}
                  <ul className="mt-2 space-y-1">
                    {request.signers.map(signer => {
                      // Only someone who could still sign is worth chasing.
                      const outstanding = isRequestLive(request)
                        && !signer.signedAt
                        && !signer.declinedAt
                      return (
                        <li key={signer.email} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-muted-foreground" title={signer.email}>
                            {signer.name} · {signer.email}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span>
                              {signer.declinedAt
                                ? `Declined ${formatDateTime(signer.declinedAt)}`
                                : signer.signedAt
                                  ? `Signed ${formatDateTime(signer.signedAt)}`
                                  : signer.viewedAt
                                    ? `Opened ${formatDateTime(signer.viewedAt)}`
                                    : 'Not opened yet'}
                            </span>
                            {outstanding && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-micro"
                                disabled={busy === `resend:${signer.recipientKey}`}
                                title="Sends a new link. The one they already have stops working."
                                onClick={() => void handleResendSignature(request, signer.recipientKey)}
                              >
                                {busy === `resend:${signer.recipientKey}`
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Send className="h-3 w-3" />}
                                Resend
                              </Button>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })()}
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
