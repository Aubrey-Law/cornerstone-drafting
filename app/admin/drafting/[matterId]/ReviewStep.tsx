'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Combine,
  Download,
  Eye,
  FileText,
  FileType2,
  Loader2,
  Maximize2,
  Minimize2,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import '@/app/intake/guided.css'
import { GuidedIntroCard, guidedCardStyle, guidedKickerStyle } from '@/components/guided'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  deleteDocument,
  getDocumentUrl,
  getDocumentViewerUrl,
  isPdfDocument,
  isWordDocument,
  setDocumentReviewed,
  updateDocumentFolder,
  uploadDocument,
} from '@/lib/documents'
import { canPromoteDraft } from '@/lib/drafting/reviewGate'
import { logMatterActivity } from '@/lib/matterActivity'
import { formatDateTime } from '@/lib/utils'
import { type MatterDocument } from '@/types/database'
import type { DraftingHubDocument, DraftingHubMatter } from '@/lib/queries/drafting'
import { TabularReviewSection } from '@/components/drafting/TabularReviewSection'
import { MatterAssistantPanel } from '@/components/drafting/MatterAssistantPanel'

const PromoteDocumentDialog = dynamic(
  () => import('@/components/documents/PromoteDocumentDialog').then(m => ({ default: m.PromoteDocumentDialog })),
  { ssr: false },
)

const DocxViewerPanel = dynamic(
  () => import('@/components/documents/DocxViewerPanel').then(m => ({ default: m.DocxViewerPanel })),
  { ssr: false },
)

const CombineWordDraftsDialog = dynamic(
  () => import('@/components/drafting/CombineWordDraftsDialog').then(m => ({ default: m.CombineWordDraftsDialog })),
  { ssr: false },
)

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

interface ReviewStepProps {
  matterId: string
  hubMatter: DraftingHubMatter | null
  sharedDrafts: MatterDocument[]
}

export default function ReviewStep({ matterId, hubMatter, sharedDrafts }: ReviewStepProps) {
  const router = useRouter()
  const accessToken = useAccessToken()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [promotedIds, setPromotedIds] = useState<Set<string>>(() => new Set())
  const [pendingPromotion, setPendingPromotion] = useState<
    { doc: DraftingHubDocument; toFolder: MatterDocument['folder'] } | null
  >(null)

  const [showPrevious, setShowPrevious] = useState(false)
  const autoExpandedSuperseded = useRef(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [viewerDoc, setViewerDoc] = useState<{ id: string; name: string; quote?: string | null } | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [assistantWidth, setAssistantWidth] = useState(340)
  const [scrollToViewer, setScrollToViewer] = useState(false)
  const viewerSectionRef = useRef<HTMLDivElement>(null)
  const pdfUploadRef = useRef<HTMLInputElement>(null)

  const openInApp = (doc: { id: string; name: string }, quote?: string | null) => {
    const alreadyOpen = viewerDoc?.id === doc.id && !quote
    if (alreadyOpen) {
      setViewerDoc(null)
      return
    }
    setViewerDoc({ id: doc.id, name: doc.name, quote: quote ?? null })
    setAssistantOpen(true)
    setScrollToViewer(true)
  }

  const openCitationInViewer = (payload: { documentId: string; documentName: string; quote: string }) => {
    setViewerDoc({
      id: payload.documentId,
      name: payload.documentName,
      quote: payload.quote,
    })
    setAssistantOpen(true)
    setScrollToViewer(true)
  }

  useEffect(() => {
    // Don't fight the browser scroll while the viewer fills the screen.
    if (!scrollToViewer || !viewerDoc || maximized) {
      if (scrollToViewer) setScrollToViewer(false)
      return
    }
    viewerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setScrollToViewer(false)
  }, [scrollToViewer, viewerDoc, maximized])

  // Escape exits fullscreen; reset the flag whenever the viewer closes.
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])

  const closeViewer = () => {
    setViewerDoc(null)
    setMaximized(false)
  }

  // Drag the divider between the document and the assistant (lg screens only).
  const startAssistantResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = assistantWidth
    const onMove = (ev: PointerEvent) => {
      // Dragging left (negative delta) widens the assistant panel.
      const next = Math.min(560, Math.max(280, startWidth - (ev.clientX - startX)))
      setAssistantWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const nudgeAssistantWidth = (delta: number) => {
    setAssistantWidth(prev => Math.min(560, Math.max(280, prev + delta)))
  }

  // Optimistic review-state overrides keyed by document id (ISO string when
  // reviewed, null when cleared) so the checkbox + gate update before refresh.
  const [reviewedOverride, setReviewedOverride] = useState<Record<string, string | null>>({})

  const effectiveReviewedAt = (doc: DraftingHubDocument): string | null =>
    doc.id in reviewedOverride ? reviewedOverride[doc.id] : doc.reviewedAt

  const handleToggleReviewed = async (doc: DraftingHubDocument, reviewed: boolean) => {
    if (reviewingId) return
    setReviewingId(doc.id)
    try {
      await setDocumentReviewed(doc.id, reviewed)
      setReviewedOverride(prev => ({ ...prev, [doc.id]: reviewed ? new Date().toISOString() : null }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update review status')
    } finally {
      setReviewingId(null)
    }
  }

  const recentDrafts = (hubMatter?.recentDrafts ?? []).filter(d => !deletedIds.has(d.id) && !promotedIds.has(d.id))
  const hidden = (hubMatter?.recentDrafts ?? []).filter(d => deletedIds.has(d.id) || promotedIds.has(d.id)).length
  const draftCount = hubMatter ? Math.max(0, hubMatter.draftCount - hidden) : 0
  const supersededDrafts = (hubMatter?.supersededDrafts ?? []).filter(d => !deletedIds.has(d.id))

  // Combining only works for .docx drafts — the merge embeds each file as an
  // OOXML altChunk, which legacy .doc binaries don't support.
  const [combineOpen, setCombineOpen] = useState(false)
  const combinableDrafts = recentDrafts.filter(d => d.name.toLowerCase().endsWith('.docx'))

  // Bulk actions: a full plan is many documents; reviewing and sharing them
  // one at a time is needless clicking.
  const [bulkBusy, setBulkBusy] = useState<'review' | 'share' | null>(null)
  const [pendingBulkShare, setPendingBulkShare] = useState<DraftingHubDocument[] | null>(null)
  const bulkReviewables = recentDrafts.filter(d => !isWordDocument(d.name) && !effectiveReviewedAt(d))
  const bulkShareables = recentDrafts.filter(d =>
    isPdfDocument(d.name) && canPromoteDraft({ markerCount: d.markerCount, reviewedAt: effectiveReviewedAt(d) }).ok,
  )

  const handleMarkAllReviewed = async () => {
    if (bulkBusy) return
    setBulkBusy('review')
    let done = 0
    for (const doc of bulkReviewables) {
      try {
        await setDocumentReviewed(doc.id, true)
        setReviewedOverride(prev => ({ ...prev, [doc.id]: new Date().toISOString() }))
        done += 1
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not mark ${doc.name} reviewed`)
      }
    }
    setBulkBusy(null)
    if (done > 0) toast.success(`Marked ${done} draft${done === 1 ? '' : 's'} reviewed`)
  }

  const confirmBulkShare = async () => {
    const docs = pendingBulkShare ?? []
    setPendingBulkShare(null)
    if (docs.length === 0 || bulkBusy) return
    setBulkBusy('share')
    let done = 0
    for (const doc of docs) {
      try {
        await updateDocumentFolder(doc.id, 'review', { confirmed: true })
        setPromotedIds(prev => new Set(prev).add(doc.id))
        done += 1
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not share ${doc.name}`)
      }
    }
    setBulkBusy(null)
    if (done > 0) {
      void logMatterActivity(matterId, 'draft_promoted_to_review', 'Drafts shared with client', {
        detail: `Shared ${done} reviewed PDF${done === 1 ? '' : 's'} with the client`,
        metadata: { count: done, documentIds: docs.map(d => d.id) },
      })
      toast.success(`Shared ${done} PDF${done === 1 ? '' : 's'} with client`)
      router.refresh()
    }
  }

  useEffect(() => {
    if (!autoExpandedSuperseded.current && supersededDrafts.length > 0) {
      setShowPrevious(true)
      autoExpandedSuperseded.current = true
    }
  }, [supersededDrafts.length])

  const openDocument = async (id: string, action: 'view' | 'download', name?: string) => {
    try {
      const url = action === 'view'
        ? await getDocumentViewerUrl(id, name ?? 'document')
        : await getDocumentUrl(id, action)
      if (action === 'view') {
        window.open(url, '_blank')
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = name ?? 'document'
      a.click()
    } catch {
      toast.error('Could not load document')
    }
  }

  const handleDelete = (doc: { id: string; name: string }) => {
    if (deletingId) return
    setPendingDelete(doc)
  }

  const confirmDelete = async () => {
    const doc = pendingDelete
    setPendingDelete(null)
    if (!doc || deletingId) return
    setDeletingId(doc.id)
    try {
      await deleteDocument(doc.id)
      setDeletedIds(prev => new Set(prev).add(doc.id))
      toast.success('Draft deleted')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete draft')
    } finally {
      setDeletingId(null)
    }
  }

  const handleApprove = (doc: DraftingHubDocument) => {
    if (approvingId) return
    if (!isPdfDocument(doc.name)) {
      toast.error('Upload a PDF exported from Word before sharing with clients.')
      return
    }
    setPendingPromotion({ doc, toFolder: 'review' })
  }

  const handleUploadSharedPdf = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || uploadingPdf) return
    if (!isPdfDocument(file.name, file.type)) {
      toast.error('Only PDF files can be shared with clients.')
      return
    }
    setUploadingPdf(true)
    try {
      await uploadDocument(file, matterId, 'review')
      toast.success('PDF shared with client')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload PDF')
    } finally {
      setUploadingPdf(false)
      if (pdfUploadRef.current) pdfUploadRef.current.value = ''
    }
  }

  const confirmPromotion = async () => {
    if (!pendingPromotion) return
    const { doc, toFolder } = pendingPromotion
    setApprovingId(doc.id)
    try {
      await updateDocumentFolder(doc.id, toFolder, { confirmed: true })
      setPromotedIds(prev => new Set(prev).add(doc.id))
      void logMatterActivity(matterId, 'draft_promoted_to_review', 'Draft shared with client', {
        detail: `Shared ${doc.name} as a client-visible draft`,
        metadata: { documentId: doc.id, documentName: doc.name, fromFolder: 'draft', toFolder },
      })
      toast.success('Draft shared with client')
      setPendingPromotion(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not share draft')
    } finally {
      setApprovingId(null)
    }
  }

  const handleConvertPdf = async (doc: DraftingHubDocument) => {
    if (!accessToken || convertingId) return
    setConvertingId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/convert-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 501) {
        toast.message('Convert not configured', {
          description: 'Set DOCX_PDF_CONVERT_URL or use Upload PDF to share.',
        })
        return
      }
      if (!res.ok) throw new Error(body.error ?? 'Conversion failed')
      toast.success('PDF created in Review folder')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert to PDF')
    } finally {
      setConvertingId(null)
    }
  }

  // In-viewer draft switching walks the Word drafts (the only kind the in-app
  // viewer renders); PDFs open in a new tab instead.
  const wordDrafts = recentDrafts.filter(d => isWordDocument(d.name))
  const viewerDraft = viewerDoc ? recentDrafts.find(d => d.id === viewerDoc.id) ?? null : null
  const viewerIndex = viewerDoc ? wordDrafts.findIndex(d => d.id === viewerDoc.id) : -1

  const switchToDraft = (id: string) => {
    const target = wordDrafts.find(d => d.id === id)
    if (target) setViewerDoc({ id: target.id, name: target.name, quote: null })
  }

  const stepDraft = (dir: 1 | -1) => {
    if (viewerIndex < 0 || wordDrafts.length === 0) return
    const next = (viewerIndex + dir + wordDrafts.length) % wordDrafts.length
    const target = wordDrafts[next]
    if (target) setViewerDoc({ id: target.id, name: target.name, quote: null })
  }

  return (
    <div className="guided-interview space-y-4">
      <GuidedIntroCard
        pct={sharedDrafts.length > 0 && recentDrafts.every(d => effectiveReviewedAt(d)) ? 100 : recentDrafts.length > 0 ? 50 : 0}
        title="Review and share drafts"
        subtitle="Mark Word drafts reviewed, convert or upload PDFs, open a draft in-app to redline, then share PDFs with the client."
      />

      <section style={{ ...guidedCardStyle, padding: 0, overflow: 'hidden' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--gi-divider)' }}>
          <div>
            <h3 className="text-base font-medium" style={{ color: 'var(--gi-heading)' }}>Internal Word drafts</h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--gi-muted)' }}>
              Open in-app to redline, convert to PDF via the LibreOffice worker, or upload a PDF.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {bulkReviewables.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                disabled={bulkBusy !== null}
                onClick={() => void handleMarkAllReviewed()}
              >
                {bulkBusy === 'review' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Mark all {bulkReviewables.length} reviewed
              </Button>
            )}
            {bulkShareables.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px] text-green hover:bg-green-bg"
                disabled={bulkBusy !== null}
                onClick={() => setPendingBulkShare(bulkShareables)}
              >
                {bulkBusy === 'share' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Share all {bulkShareables.length} ready
              </Button>
            )}
            {combinableDrafts.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                onClick={() => setCombineOpen(true)}
              >
                <Combine className="h-3.5 w-3.5" />
                Combine into one file
              </Button>
            )}
            <input
              ref={pdfUploadRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => void handleUploadSharedPdf(e.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[11px]"
              disabled={uploadingPdf}
              onClick={() => pdfUploadRef.current?.click()}
            >
              {uploadingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload PDF to share
            </Button>
            {supersededDrafts.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-amber-border bg-amber-bg text-[11px] text-amber hover:bg-amber-light"
                onClick={() => setShowPrevious(prev => !prev)}
              >
                {showPrevious ? 'Hide' : 'Show'} previous versions ({supersededDrafts.length})
              </Button>
            )}
            {supersededDrafts.length > 0 && (
              <Badge variant="outline" className="border-amber-border bg-amber-bg text-[11px] text-amber">
                {supersededDrafts.length} superseded
              </Badge>
            )}
            <Badge variant="outline" className="text-[11px]">{draftCount} current</Badge>
          </div>
        </div>
        {recentDrafts.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--gi-muted)' }}>No internal drafts have been generated yet. Use the Generate step to produce drafts.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--gi-divider)' }}>
            {recentDrafts.map(doc => {
              const reviewedAt = effectiveReviewedAt(doc)
              const isWord = isWordDocument(doc.name)
              const isPdf = isPdfDocument(doc.name)
              const isOpen = viewerDoc?.id === doc.id
              const gate = isPdf
                ? canPromoteDraft({ markerCount: doc.markerCount, reviewedAt })
                : { ok: typeof doc.markerCount !== 'number' || doc.markerCount === 0, reason: doc.markerCount && doc.markerCount > 0 ? 'markers' as const : undefined }
              const gateTitle = gate.reason === 'markers'
                ? 'Resolve the unresolved markers and regenerate before sharing'
                : gate.reason === 'not_reviewed'
                  ? 'Mark this draft reviewed before sharing'
                  : isWord
                    ? 'Export a PDF from Word and use Upload PDF to share'
                    : undefined
              return (
                <div
                  key={doc.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isOpen ? 'bg-accent/5' : ''}`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatSize(doc.size)} · Generated {formatDateTime(doc.created_at)}
                      {reviewedAt ? ` · Reviewed ${formatDateTime(reviewedAt)}` : ''}
                    </p>
                  </div>
                  {doc.markerCount === 0 ? (
                    <Badge variant="outline" className="gap-1 border-success/30 text-[11px] text-success">
                      <CheckCircle2 className="h-3 w-3" /> Clean
                    </Badge>
                  ) : typeof doc.markerCount === 'number' && doc.markerCount > 0 ? (
                    <Badge variant="outline" className="gap-1 border-destructive/30 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {doc.markerCount} marker{doc.markerCount === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">Not scanned</Badge>
                  )}
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={!!reviewedAt}
                      disabled={reviewingId === doc.id || isWord}
                      onCheckedChange={checked => void handleToggleReviewed(doc, checked === true)}
                      aria-label={`Mark ${doc.name} reviewed`}
                    />
                    Reviewed
                  </label>
                  {isWord ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant={isOpen ? 'secondary' : 'outline'}
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => openInApp(doc)}
                        >
                          <BookOpen className="h-3.5 w-3.5" /> {isOpen ? 'Hide viewer' : 'Review in app'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open the in-app viewer to read, redline, and step through tracked changes.</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void openDocument(doc.id, 'view', doc.name)}>
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void openDocument(doc.id, 'download', doc.name)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                  {isWord ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      disabled={convertingId === doc.id}
                      title="Convert DOCX→PDF via convert worker (or configure DOCX_PDF_CONVERT_URL)"
                      onClick={() => void handleConvertPdf(doc)}
                    >
                      {convertingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileType2 className="h-3.5 w-3.5" />}
                      Convert PDF
                    </Button>
                  ) : null}
                  {isPdf ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs text-green hover:bg-green-bg"
                      disabled={approvingId === doc.id || !gate.ok}
                      title={gateTitle}
                      onClick={() => handleApprove(doc)}
                    >
                      {approvingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Share PDF
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs text-red-strong hover:bg-red-bg"
                    disabled={deletingId === doc.id}
                    onClick={() => handleDelete(doc)}
                  >
                    {deletingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        <div className="border-t px-5 py-4" style={{ borderColor: 'var(--gi-divider)', background: 'var(--gi-surface-alt)' }}>
          <p style={{ ...guidedKickerStyle, marginBottom: 8 }}>Included when emailing client review link (PDF only)</p>
          {sharedDrafts.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No shared PDFs yet. Upload a PDF exported from Word.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-foreground">
              {sharedDrafts.map(doc => (
                <li key={doc.id} className="flex items-center justify-between gap-3 rounded border border-border bg-background px-2 py-1.5">
                  <span className="truncate">{doc.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatDateTime(doc.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {showPrevious && supersededDrafts.length > 0 && (
          <div className="border-t" style={{ borderColor: 'var(--gi-divider)' }}>
            <p className="px-5 pt-3 text-[11px] font-medium uppercase" style={{ color: 'var(--gi-faint)' }}>
              Previous versions — replaced by a later generation, kept for reference
            </p>
            <div className="divide-y" style={{ borderColor: 'var(--gi-divider)' }}>
              {supersededDrafts.map(doc => (
                <div key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3 opacity-70">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatSize(doc.size)} · Generated {formatDateTime(doc.created_at)}
                      {doc.supersededAt ? ` · Superseded ${formatDateTime(doc.supersededAt)}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">Superseded</Badge>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void openDocument(doc.id, 'view', doc.name)}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void openDocument(doc.id, 'download', doc.name)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* In-app document review — viewer + assistant side-by-side below drafts list */}
      {viewerDoc ? (
        <section
          ref={viewerSectionRef}
          className={
            maximized
              ? 'fixed inset-0 z-50 flex flex-col overflow-hidden border-0 bg-card'
              : 'overflow-hidden rounded-lg border border-border bg-card'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="shrink-0 text-xs text-muted-foreground">Reviewing</span>
              {wordDrafts.length > 1 ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => stepDraft(-1)}
                    aria-label="Previous draft"
                    title="Previous draft"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Select value={viewerDoc.id} onValueChange={switchToDraft}>
                    <SelectTrigger className="h-7 max-w-[420px] min-w-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {wordDrafts.map(d => (
                        <SelectItem key={d.id} value={d.id} className="text-xs">
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => stepDraft(1)}
                    aria-label="Next draft"
                    title="Next draft"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <span className="truncate text-xs font-medium text-foreground">{viewerDoc.name}</span>
              )}
              {viewerDoc.quote ? (
                <span className="shrink-0 text-xs text-muted-foreground"> · citation highlight active</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={assistantOpen ? 'secondary' : 'outline'}
                className="h-7 gap-1.5 text-[11px]"
                onClick={() => setAssistantOpen(open => !open)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {assistantOpen ? 'Hide assistant' : 'Show assistant'}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setMaximized(m => !m)}
                    aria-label={maximized ? 'Exit fullscreen' : 'Maximize viewer'}
                  >
                    {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{maximized ? 'Exit fullscreen (Esc)' : 'Maximize viewer'}</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                onClick={closeViewer}
              >
                Done
              </Button>
            </div>
          </div>
          <div
            className={
              maximized
                ? 'flex min-h-0 flex-1 flex-col lg:flex-row'
                : assistantOpen
                  ? 'flex h-[min(78vh,920px)] min-h-[520px] flex-col lg:flex-row'
                  : 'flex h-[min(78vh,920px)] min-h-[520px] flex-col'
            }
          >
            <div className="min-h-0 min-w-0 flex-1 border-b border-border lg:border-b-0 lg:border-r">
              <DocxViewerPanel
                documentId={viewerDoc.id}
                documentName={viewerDoc.name}
                quote={viewerDoc.quote}
                maximized={maximized}
                onConvert={viewerDraft ? () => void handleConvertPdf(viewerDraft) : undefined}
                converting={viewerDraft ? convertingId === viewerDraft.id : false}
                onClose={closeViewer}
                onMutated={() => router.refresh()}
              />
            </div>
            {assistantOpen ? (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize assistant panel"
                  tabIndex={0}
                  onPointerDown={startAssistantResize}
                  onKeyDown={e => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeAssistantWidth(24) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); nudgeAssistantWidth(-24) }
                  }}
                  className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent focus:bg-accent focus:outline-none lg:block"
                />
                <aside
                  className="min-h-[280px] w-full shrink-0 border-t border-border lg:min-h-0 lg:w-[var(--assistant-w)] lg:border-t-0"
                  style={{ ['--assistant-w' as string]: `${assistantWidth}px` }}
                >
                  <MatterAssistantPanel
                    matterId={matterId}
                    documentIds={[viewerDoc.id, ...recentDrafts.map(d => d.id).filter(id => id !== viewerDoc.id)]}
                    onClose={() => setAssistantOpen(false)}
                  />
                </aside>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <TabularReviewSection
        matterId={matterId}
        documentIds={recentDrafts.map(d => d.id)}
        documents={recentDrafts.map(d => ({ id: d.id, name: d.name }))}
        onOpenCitation={openCitationInViewer}
      />

      <PromoteDocumentDialog
        pending={pendingPromotion}
        onCancel={() => setPendingPromotion(null)}
        onConfirm={confirmPromotion}
      />

      {combineOpen && (
        <CombineWordDraftsDialog
          open={combineOpen}
          onOpenChange={setCombineOpen}
          documents={combinableDrafts.map(doc => ({ id: doc.id, name: doc.name }))}
          defaultFilename={hubMatter?.matter.matter_name
            ? `${hubMatter.matter.matter_name} - Combined Drafts`
            : undefined}
        />
      )}

      <AlertDialog open={pendingBulkShare !== null} onOpenChange={open => { if (!open) setPendingBulkShare(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Share {pendingBulkShare?.length ?? 0} reviewed PDF{(pendingBulkShare?.length ?? 0) === 1 ? '' : 's'} with the client?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These become visible in the client portal and the client is notified by email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-xs">
            {(pendingBulkShare ?? []).map(doc => (
              <li key={doc.id} className="truncate font-medium">{doc.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmBulkShare()}>Share with client</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{pendingDelete?.name}&rdquo; will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
