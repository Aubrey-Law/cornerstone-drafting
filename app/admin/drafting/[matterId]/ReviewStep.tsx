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
  MoreHorizontal,
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
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  deleteDocument,
  getDocumentUrl,
  isPdfDocument,
  isWordDocument,
  setDocumentReviewed,
  setDocumentShared,
  uploadDocument,
} from '@/lib/documents'
import { logMatterActivity } from '@/lib/matterActivity'
import { formatDateTime } from '@/lib/utils'
import { type MatterDocument } from '@/types/database'
import type { DraftingHubDocument, DraftingHubMatter } from '@/lib/queries/drafting'
import { groupDraftHistory, nextUnreviewedDraft, reviewReadthrough, runSelectedConversion, type ConversionResult } from '@/lib/drafting/reviewWorkflow'
import { DocumentComparisonDialog } from '@/components/drafting/DocumentComparisonDialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { ShareCheck } from '@/lib/documents/shareGate'
import { TabularReviewSection } from '@/components/drafting/TabularReviewSection'
import { MatterAssistantPanel } from '@/components/drafting/MatterAssistantPanel'

const DocxViewerPanel = dynamic(
  () => import('@/components/documents/DocxViewerPanel').then(m => ({ default: m.DocxViewerPanel })),
  { ssr: false },
)

const CombineWordDraftsDialog = dynamic(
  () => import('@/components/drafting/CombineWordDraftsDialog').then(m => ({ default: m.CombineWordDraftsDialog })),
  { ssr: false },
)

/**
 * A draft whose text the model wrote, rather than a template render.
 *
 * 'python_fallback' is the same thing under its old name: the label was
 * inherited from a Python subprocess engine retired long before, and rows
 * written before migration 20261021000000 still carry it. Both are matched so a
 * legacy draft is not shown as though a template produced it.
 */
function isModelDrafted(generationEngine: string | null | undefined): boolean {
  return generationEngine === 'llm_fallback' || generationEngine === 'python_fallback'
}

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

  const [showPrevious, setShowPrevious] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [viewerDoc, setViewerDoc] = useState<{ id: string; name: string; quote?: string | null } | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<{ id: string; name: string } | null>(null)
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
  const [reviewedOverride, setReviewedOverride] = useState<Record<string, { revision: string; reviewedAt: string | null }>>({})
  const loadedRevisions = useRef<Record<string, string | null>>({})
  const [viewedRevisions, setViewedRevisions] = useState<Record<string, string | null>>({})
  const [eligibilities, setEligibilities] = useState<Record<string, ShareCheck>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [conversionResults, setConversionResults] = useState<ConversionResult[]>([])
  const [batchConverting, setBatchConverting] = useState(false)
  const conversionLock = useRef(false)
  const [comparison, setComparison] = useState<{ current: DraftingHubDocument; previous?: DraftingHubDocument } | null>(null)

  const loadedRevision = (documentId: string, revision: string | null) => {
    loadedRevisions.current[documentId] = revision
    setViewedRevisions(prev => ({ ...prev, [documentId]: revision }))
    setEligibilities(prev => { const next = { ...prev }; delete next[documentId]; return next })
    if (revision && accessToken) {
      void fetch(`/api/documents/${documentId}/review`, { headers: { Authorization: `Bearer ${accessToken}` } })
        .then(async res => {
          if (!res.ok) throw new Error('Could not check this version for unfilled fields')
          const state = await res.json()
          if (loadedRevisions.current[documentId] !== revision) return
          if (state.reviewRevision !== revision) {
            setViewedRevisions(prev => ({ ...prev, [documentId]: null }))
            setEligibilities(prev => ({ ...prev, [documentId]: { shareable: false, reason: 'unverifiable', detail: 'This document changed. Close and reopen the viewer to load its current version.' } }))
          } else {
            setEligibilities(prev => ({ ...prev, [documentId]: state.eligibility }))
            setReviewedOverride(prev => ({ ...prev, [documentId]: { revision, reviewedAt: state.reviewedAt ?? null } }))
          }
        }).catch(() => {
          if (loadedRevisions.current[documentId] === revision) setEligibilities(prev => ({ ...prev, [documentId]: { shareable: false, reason: 'unverifiable', detail: 'Could not check this version. Close and reopen the viewer to retry.' } }))
        })
    }
  }


  const effectiveReviewedAt = (doc: DraftingHubDocument): string | null => {
    const override = reviewedOverride[doc.id]
    return override && override.revision === (doc.reviewRevision ?? viewedRevisions[doc.id]) ? override.reviewedAt : doc.reviewedAt
  }
  const currentEligibility = (doc: DraftingHubDocument) =>
    !doc.reviewRevision || doc.reviewRevision === viewedRevisions[doc.id] ? eligibilities[doc.id] : undefined
  const hasCurrentBytes = (doc: DraftingHubDocument) => Boolean(viewedRevisions[doc.id] && (!doc.reviewRevision || doc.reviewRevision === viewedRevisions[doc.id]))

  const handleToggleReviewed = async (doc: DraftingHubDocument, reviewed: boolean) => {
    if (reviewingId || !hasCurrentBytes(doc)) return
    setReviewingId(doc.id)
    try {
      const revision = viewedRevisions[doc.id]!
      await setDocumentReviewed(doc.id, reviewed, revision)
      setReviewedOverride(prev => ({ ...prev, [doc.id]: { revision, reviewedAt: reviewed ? new Date().toISOString() : null } }))
      router.refresh()
    } catch (e) {
      loadedRevision(doc.id, null)
      router.refresh()
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

  // Sharing is explicit and still rechecked server-side for each PDF.
  const [bulkBusy, setBulkBusy] = useState<'share' | null>(null)
  const [pendingBulkShare, setPendingBulkShare] = useState<DraftingHubDocument[] | null>(null)
  const bulkShareables = recentDrafts.filter(d => isPdfDocument(d.name) && (d.missingCount ?? 0) === 0)
  const groups = groupDraftHistory(recentDrafts, supersededDrafts)
  const reviewedDrafts = recentDrafts.map(d => ({ ...d, reviewedAt: effectiveReviewedAt(d) }))
  const wordReview = reviewReadthrough(reviewedDrafts)
  const nextUnreviewed = nextUnreviewedDraft(reviewedDrafts, viewerDoc?.id ?? null)

  const confirmBulkShare = async () => {
    const docs = pendingBulkShare ?? []
    setPendingBulkShare(null)
    if (docs.length === 0 || bulkBusy) return
    setBulkBusy('share')
    let done = 0
    for (const doc of docs) {
      try {
        await setDocumentShared(doc.id, true)
        setPromotedIds(prev => new Set(prev).add(doc.id))
        done += 1
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not share ${doc.name}`)
      }
    }
    setBulkBusy(null)
    if (done > 0) {
      void logMatterActivity(matterId, 'draft_promoted_to_review', 'Drafts shared with client', {
        detail: `Shared ${done} eligible PDF${done === 1 ? '' : 's'} with the client`,
        metadata: { count: done, documentIds: docs.map(d => d.id) },
      })
      toast.success(`Shared ${done} PDF${done === 1 ? '' : 's'} with client`)
      router.refresh()
    }
  }

  const openDocument = async (id: string, action: 'view' | 'download', name?: string) => {
    // Drafts are Word documents; preview them in-app rather than handing a
    // signed R2 URL to an external viewer.
    if (action === 'view' && isWordDocument(name ?? 'document')) {
      setPreviewTarget({ id, name: name ?? 'document' })
      return
    }
    try {
      let url: string
      if (action === 'view' && accessToken) {
        const response = await fetch(`/api/documents/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (!response.ok) throw new Error('Could not load document')
        const body = await response.json()
        url = body.url
        loadedRevision(id, body.reviewRevision)
      } else url = await getDocumentUrl(id, action)
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
      setSelectedIds(prev => { const next = new Set(prev); next.delete(doc.id); return next })
      toast.success('Draft deleted')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete draft')
    } finally {
      setDeletingId(null)
    }
  }

  const handleApprove = async (doc: DraftingHubDocument) => {
    if (approvingId) return
    setApprovingId(doc.id)
    try {
      await setDocumentShared(doc.id, true)
      setPromotedIds(prev => new Set(prev).add(doc.id))
      void logMatterActivity(matterId, 'draft_promoted_to_review', 'Draft shared with client', {
        detail: `Shared ${doc.name} with the client`,
        metadata: { documentId: doc.id, documentName: doc.name },
      })
      toast.success('Draft shared with client')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not share draft')
    } finally {
      setApprovingId(null)
    }
  }

  const handleUploadSharedPdf = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || uploadingPdf) return
    setUploadingPdf(true)
    try {
      const newDoc = await uploadDocument(file, matterId)
      await setDocumentShared(newDoc.id, true)
      toast.success('Document shared with client')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload PDF')
    } finally {
      setUploadingPdf(false)
      if (pdfUploadRef.current) pdfUploadRef.current.value = ''
    }
  }

  const convertOne = async (doc: DraftingHubDocument) => {
    if (!accessToken) throw new Error('Not authenticated')
    const res = await fetch(`/api/documents/${doc.id}/convert-pdf`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Conversion failed')
  }

  const handleConvertPdf = async (doc: DraftingHubDocument) => {
    if (conversionLock.current) return
    conversionLock.current = true
    setConvertingId(doc.id)
    try {
      const results = await runSelectedConversion([doc], new Set([doc.id]), convertOne)
      setConversionResults(results)
      if (results[0]?.status === 'converted') router.refresh()
    } finally {
      conversionLock.current = false
      setConvertingId(null)
    }
  }

  const convertSelected = async () => {
    if (conversionLock.current) return
    conversionLock.current = true
    setBatchConverting(true)
    try {
      const results = await runSelectedConversion(recentDrafts, selectedIds, convertOne)
      setConversionResults(results)
      setSelectedIds(new Set(results.filter(r => r.status === 'failed').map(r => r.id)))
      if (results.some(r => r.status === 'converted')) router.refresh()
    } finally {
      conversionLock.current = false
      setBatchConverting(false)
    }
  }

  // In-viewer draft switching walks the Word drafts (the only kind the in-app
  // viewer renders); PDFs open in a new tab instead.
  const wordDrafts = recentDrafts.filter(d => isWordDocument(d.name))
  const viewerDraft = viewerDoc ? recentDrafts.find(d => d.id === viewerDoc.id) ?? null : null
  const viewerIndex = viewerDoc ? wordDrafts.findIndex(d => d.id === viewerDoc.id) : -1
  const openUnreviewed = viewerDraft && isWordDocument(viewerDraft.name) && !effectiveReviewedAt(viewerDraft)
    ? viewerDraft
    : null
  const leadDraft = openUnreviewed
    ?? (nextUnreviewed ? recentDrafts.find(d => d.id === nextUnreviewed.id) ?? null : null)

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
    <div className="guided-interview guided-zinc space-y-4">
      <GuidedIntroCard
        pct={wordReview.pct}
        title="Review and share drafts"
        subtitle={wordReview.total === 0
          ? 'Generate drafts, then read each Word version and mark it reviewed.'
          : `${wordReview.reviewed} of ${wordReview.total} Word drafts reviewed. Convert and share after the read-through.`}
      />

      {leadDraft ? (
        <section style={guidedCardStyle} aria-label="Next to review">
          <p style={guidedKickerStyle}>Next to review</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium" style={{ color: 'var(--gi-heading)' }}>{leadDraft.name}</h2>
              <p className="mt-1 text-xs" style={{ color: 'var(--gi-muted)' }}>
                {openUnreviewed
                  ? 'Read this version, then mark it reviewed.'
                  : 'Open this draft and read it before marking it reviewed.'}
              </p>
            </div>
            {openUnreviewed ? (
              <Button
                size="sm"
                disabled={reviewingId !== null || !hasCurrentBytes(leadDraft)}
                onClick={() => void handleToggleReviewed(leadDraft, true)}
              >
                {reviewingId === leadDraft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Mark reviewed'}
              </Button>
            ) : (
              <Button size="sm" onClick={() => openInApp(leadDraft)}>
                Review in app
              </Button>
            )}
          </div>
        </section>
      ) : wordReview.total > 0 ? (
        <section style={guidedCardStyle}>
          <p style={guidedKickerStyle}>Next to review</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--gi-heading)' }}>All current Word drafts are marked reviewed.</p>
        </section>
      ) : null}

      <section style={{ ...guidedCardStyle, padding: 0, overflow: 'hidden' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--gi-divider)' }}>
          <div>
            <h3 className="text-base font-medium" style={{ color: 'var(--gi-heading)' }}>Current documents</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--gi-muted)' }}>
              Review status and missing-field eligibility are separate. Sharing checks unfilled fields again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={batchConverting || convertingId !== null || selectedIds.size === 0} onClick={() => void convertSelected()}>
              {batchConverting ? 'Converting…' : `Convert selected (${selectedIds.size})`}
            </Button>
            {bulkShareables.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-micro text-green hover:bg-green-bg"
                disabled={bulkBusy !== null}
                onClick={() => setPendingBulkShare(bulkShareables)}
              >
                {bulkBusy === 'share' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Share {bulkShareables.length} eligible PDFs
              </Button>
            )}
            <input
              ref={pdfUploadRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => void handleUploadSharedPdf(e.target.files)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 w-7" aria-label="More document actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {combinableDrafts.length > 1 && (
                  <DropdownMenuItem onSelect={() => setCombineOpen(true)}>
                    <Combine className="mr-2 h-4 w-4" />
                    Combine into one file
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={uploadingPdf} onSelect={() => pdfUploadRef.current?.click()}>
                  {uploadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Upload PDF to share
                </DropdownMenuItem>
                {supersededDrafts.length > 0 && (
                  <DropdownMenuItem onSelect={() => setShowPrevious(prev => !prev)}>
                    {showPrevious ? 'Hide' : 'Show'} previous versions ({supersededDrafts.length})
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {supersededDrafts.length > 0 && (
              <Badge variant="outline" className="border-amber-border bg-amber-bg text-micro text-amber">
                {supersededDrafts.length} superseded
              </Badge>
            )}
            <Badge variant="outline" className="text-micro">{draftCount} current</Badge>
          </div>
        </div>
        {recentDrafts.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--gi-muted)' }}>No internal drafts have been generated yet. Use the Generate step to produce drafts.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--gi-divider)' }}>
            {groups.map(({ current: doc, previous }) => {
              const reviewedAt = effectiveReviewedAt(doc)
              const isWord = isWordDocument(doc.name)
              const isPdf = isPdfDocument(doc.name)
              const isOpen = viewerDoc?.id === doc.id
              return (
                <div
                  key={doc.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isOpen ? 'bg-primary/5' : ''}`}
                >
                  {doc.name.toLowerCase().endsWith('.docx') && <Checkbox aria-label={`Select ${doc.name} for conversion`} checked={selectedIds.has(doc.id)} disabled={batchConverting || convertingId !== null} onCheckedChange={checked => setSelectedIds(prev => { const next = new Set(prev); if (checked) next.add(doc.id); else next.delete(doc.id); return next })} />}
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.name}</p>
                    <p className="text-micro text-muted-foreground">
                      {formatSize(doc.size)} · Generated {formatDateTime(doc.created_at)}
                      {reviewedAt ? ` · Reviewed ${formatDateTime(reviewedAt)}` : ' · Needs review'}
                    </p>
                  </div>
                  {isModelDrafted(doc.generationEngine) && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-border bg-amber-bg text-micro text-amber"
                      title="Template generation failed for this document, so its text was drafted by the model. Read it in full before approving."
                    >
                      <Sparkles className="h-3 w-3" /> AI-drafted
                    </Badge>
                  )}
                  {doc.markerCount === 0 ? (
                    <Badge variant="outline" className="gap-1 border-success/30 text-micro text-success">
                      <CheckCircle2 className="h-3 w-3" /> No recorded markers
                    </Badge>
                  ) : typeof doc.markerCount === 'number' && doc.markerCount > 0 ? (
                    <Badge variant="outline" className="gap-1 border-destructive/30 text-micro text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {doc.markerCount} marker{doc.markerCount === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-micro text-muted-foreground">Not scanned</Badge>
                  )}
                  <Badge variant="outline" className={doc.missingCount ? 'text-destructive' : 'text-muted-foreground'}>
                    {currentEligibility(doc)?.shareable ? 'Missing-field check passed' : currentEligibility(doc)?.shareable === false ? 'Sharing blocked' : doc.missingCount ? `${doc.missingCount} unfilled fields · sharing blocked` : isPdf ? 'Eligible to share' : 'Check fields in viewer'}
                  </Badge>
                  {!isWord && <Button size="sm" variant="outline" disabled={reviewingId !== null || !hasCurrentBytes(doc)} onClick={() => void handleToggleReviewed(doc, !reviewedAt)} title="Open this version before marking it reviewed">{reviewedAt ? 'Clear review' : 'Mark reviewed'}</Button>}
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
                  {isPdf && <Button size="sm" variant="outline" disabled={approvingId === doc.id || currentEligibility(doc)?.shareable === false || (!currentEligibility(doc) && (doc.missingCount ?? 0) > 0)} onClick={() => void handleApprove(doc)}><Send className="mr-1 h-3.5 w-3.5" />Share PDF</Button>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`More actions for ${doc.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void openDocument(doc.id, 'download', doc.name)}><Download className="mr-2 h-4 w-4" />Download</DropdownMenuItem>
                      {doc.name.toLowerCase().endsWith('.docx') && <DropdownMenuItem disabled={batchConverting || convertingId !== null} onSelect={() => void handleConvertPdf(doc)}><FileType2 className="mr-2 h-4 w-4" />Convert to PDF</DropdownMenuItem>}
                      {isWord && <DropdownMenuItem onSelect={() => setComparison({ current: doc, previous: previous[0] })}>Compare with previous</DropdownMenuItem>}
                      <DropdownMenuItem disabled={deletingId === doc.id} onSelect={() => handleDelete(doc)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {previous.length > 0 && <details className="w-full pl-7 text-xs"><summary className="cursor-pointer text-muted-foreground">Previous generations ({previous.length})</summary><ul className="mt-2 space-y-2">{previous.map(old => <li key={old.id} className="flex flex-wrap items-center gap-2"><span>{formatDateTime(old.created_at)} · {old.name}</span><Button size="sm" variant="ghost" onClick={() => void openDocument(old.id, 'view', old.name)}>View</Button>{isWord && <Button size="sm" variant="ghost" onClick={() => setComparison({ current: doc, previous: old })}>Compare</Button>}</li>)}</ul></details>}
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
            <p className="px-5 pt-3 text-micro font-medium uppercase" style={{ color: 'var(--gi-faint)' }}>
              Previous versions — replaced by a later generation, kept for reference
            </p>
            <div className="divide-y" style={{ borderColor: 'var(--gi-divider)' }}>
              {supersededDrafts.map(doc => (
                <div key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3 opacity-70">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.name}</p>
                    <p className="text-micro text-muted-foreground">
                      {formatSize(doc.size)} · Generated {formatDateTime(doc.created_at)}
                      {doc.supersededAt ? ` · Superseded ${formatDateTime(doc.supersededAt)}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-micro text-muted-foreground">Superseded</Badge>
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

      {conversionResults.length > 0 && <section className="rounded-lg border p-4" aria-live="polite"><h3 className="text-sm font-medium">PDF conversion results</h3><p className="text-xs text-muted-foreground">Created PDFs are unreviewed and unshared. Failed documents remain selected for retry.</p><ul className="mt-2 space-y-1 text-sm">{conversionResults.map(result => <li key={result.id}>{result.name}: {result.status === 'converted' ? 'PDF created' : `Failed — ${result.error}`}</li>)}</ul></section>}

      {/* In-app document review — viewer + assistant side-by-side below drafts list */}
      {viewerDoc ? (
        <section
          ref={viewerSectionRef}
          className={
            maximized
              ? 'fixed inset-0 z-50 flex flex-col overflow-hidden border-0 bg-card'
              : 'scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card'
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
            <div className="flex flex-wrap items-center gap-1.5">
              {viewerDraft && <Button size="sm" disabled={reviewingId !== null || !hasCurrentBytes(viewerDraft)} onClick={() => void handleToggleReviewed(viewerDraft, !effectiveReviewedAt(viewerDraft))}>{effectiveReviewedAt(viewerDraft) ? 'Clear review' : 'Mark this version reviewed'}</Button>}
              <Button size="sm" variant="outline" disabled={!nextUnreviewed} onClick={() => { if (nextUnreviewed) switchToDraft(nextUnreviewed.id) }}>Next unreviewed</Button>
              <Button
                type="button"
                size="sm"
                variant={assistantOpen ? 'secondary' : 'outline'}
                className="h-7 gap-1.5 text-micro"
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
                className="h-7 gap-1.5 text-micro"
                onClick={closeViewer}
              >
                Done
              </Button>
            </div>
          </div>
          <div className="border-b px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
            {(() => { const check = eligibilities[viewerDoc.id]; return !check ? viewedRevisions[viewerDoc.id] ? 'Checking this version for unfilled fields…' : 'Load this version before recording a review.' : check.shareable ? 'Missing-field check passed. Mark reviewed only after reading this version.' : check.reason === 'missing_fields' ? `Sharing blocked by unfilled fields: ${check.missingFields.join(', ')}` : `Sharing eligibility could not be verified: ${check.detail}` })()}
          </div>
          <div
            className={
              maximized
                ? 'flex min-h-0 flex-1 flex-col lg:flex-row'
                : 'flex h-[min(78vh,920px)] min-h-[520px] flex-col lg:flex-row'
            }
          >
            <nav aria-label="Documents to review" className="max-h-36 shrink-0 overflow-y-auto border-b p-2 lg:max-h-none lg:w-48 lg:border-r lg:border-b-0">
              {wordDrafts.map(doc => <button key={doc.id} type="button" aria-current={doc.id === viewerDoc.id ? 'true' : undefined} onClick={() => switchToDraft(doc.id)} className={`mb-1 block w-full rounded p-2 text-left text-xs ${doc.id === viewerDoc.id ? 'bg-selected text-selected-foreground' : 'hover:bg-accent'}`}><span className="block break-words font-medium">{doc.name}</span><span className="text-muted-foreground">{effectiveReviewedAt(doc) ? 'Reviewed' : 'Needs review'}</span></button>)}
            </nav>
            <div className="min-h-0 min-w-0 flex-1 border-b border-border lg:border-b-0 lg:border-r">
              <DocxViewerPanel
                documentId={viewerDoc.id}
                key={`${viewerDoc.id}:${viewerDraft?.reviewRevision ?? ''}`}
                onRevisionLoaded={loadedRevision}
                documentName={viewerDoc.name}
                quote={viewerDoc.quote}
                maximized={maximized}
                onConvert={viewerDraft?.name.toLowerCase().endsWith('.docx') ? () => void handleConvertPdf(viewerDraft) : undefined}
                converting={batchConverting || convertingId !== null}
                onClose={closeViewer}
                onMutated={() => { loadedRevision(viewerDoc.id, null); setReviewedOverride(prev => { const next = { ...prev }; delete next[viewerDoc.id]; return next }); router.refresh() }}
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
                  className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus:bg-primary focus:outline-none lg:block"
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

      {comparison && <DocumentComparisonDialog current={comparison.current} previous={comparison.previous} onClose={() => setComparison(null)} />}

      <TabularReviewSection
        matterId={matterId}
        documentIds={recentDrafts.map(d => d.id)}
        documents={recentDrafts.map(d => ({ id: d.id, name: d.name }))}
        onOpenCitation={openCitationInViewer}
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
              Share {pendingBulkShare?.length ?? 0} eligible PDF{(pendingBulkShare?.length ?? 0) === 1 ? '' : 's'} with the client?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These become visible in the client portal and the client is notified by email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-border bg-muted p-2 text-xs">
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

      <DocumentPreviewDialog
        document={previewTarget}
        open={previewTarget !== null}
        onOpenChange={open => !open && setPreviewTarget(null)}
      />
    </div>
  )
}
