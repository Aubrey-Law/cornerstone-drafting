'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FileType2,
  Loader2,
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
    if (!scrollToViewer || !viewerDoc) return
    viewerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setScrollToViewer(false)
  }, [scrollToViewer, viewerDoc])

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
                    <Button
                      size="sm"
                      variant={isOpen ? 'secondary' : 'outline'}
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => openInApp(doc)}
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {isOpen ? 'Hide viewer' : 'Open in app'}
                    </Button>
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
        <section ref={viewerSectionRef} className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Reviewing <span className="font-medium text-foreground">{viewerDoc.name}</span>
              {viewerDoc.quote ? (
                <span className="text-muted-foreground"> · citation highlight active</span>
              ) : null}
            </p>
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
          </div>
          <div
            className={
              assistantOpen
                ? 'grid h-[min(78vh,920px)] min-h-[520px] lg:grid-cols-[minmax(0,1fr)_340px]'
                : 'h-[min(78vh,920px)] min-h-[520px]'
            }
          >
            <div className="min-h-0 min-w-0 border-r border-border">
              <DocxViewerPanel
                documentId={viewerDoc.id}
                documentName={viewerDoc.name}
                quote={viewerDoc.quote}
                onClose={() => setViewerDoc(null)}
                onMutated={() => router.refresh()}
              />
            </div>
            {assistantOpen ? (
              <aside className="min-h-[280px] border-t border-border lg:min-h-0 lg:border-t-0">
                <MatterAssistantPanel
                  matterId={matterId}
                  documentIds={[viewerDoc.id, ...recentDrafts.map(d => d.id).filter(id => id !== viewerDoc.id)]}
                  onClose={() => setAssistantOpen(false)}
                />
              </aside>
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
