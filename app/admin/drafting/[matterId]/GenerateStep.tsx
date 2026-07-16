'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock3, Download, FileText, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import '@/app/intake/guided.css'
import { guidedCardStyle } from '@/components/guided'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { designTargetForMissingField } from '@/lib/estateGenerator/missingFieldDesignMap'
import { decodeDraftDownloadMeta } from '@/lib/drafting/draftDownloadMeta'
import {
  blobToBase64,
  downloadCachedZip,
  loadDraftZipDownload,
  storeDraftZipDownload,
  type CachedDraftZip,
} from '@/lib/drafting/draftDownloadCache'
import { logMatterActivity } from '@/lib/matterActivity'
import { cn, formatDate } from '@/lib/utils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { ClauseOverridesPanel } from './ClauseOverridesPanel'

type DocumentReport = {
  name: string
  todoCount: number
  markerCount: number
  unresolved: string[]
  missingFields: string[]
}

type DraftResult =
  | {
      success: true
      documents: string[]
      warnings: string[]
      missing: string[]
      documentReports: DocumentReport[]
      hasBlockingMarkers: boolean
      downloaded?: boolean
      generationDiff?: { newDocuments: string[]; replacedDocuments: string[] }
    }
  | { success: false; error: string; failedDocuments?: string[] }

// One-line summary of why a document is flagged, e.g. "2 TODO clauses, 1 missing field".
function markerSummary(report: DocumentReport): string {
  const parts: string[] = []
  if (report.todoCount > 0) parts.push(`${report.todoCount} TODO clause${report.todoCount === 1 ? '' : 's'}`)
  if (report.missingFields.length > 0) parts.push(`${report.missingFields.length} missing field${report.missingFields.length === 1 ? '' : 's'}`)
  if (report.unresolved.length > 0) parts.push(`${report.unresolved.length} unresolved marker${report.unresolved.length === 1 ? '' : 's'}`)
  return parts.join(', ')
}

type DraftPreflightDocument = {
  packageName: string
  title: string
  filename: string
}

type DraftPreflight = {
  matterId: string
  designSheetId: string | null
  engine: 'node'
  canGenerate: boolean
  packageNames: string[]
  documentsToGenerate: DraftPreflightDocument[]
  unsupportedDocumentLabels: string[]
  fallbackPackageNames: string[]
  missing: string[]
  warnings: string[]
  error?: string
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// The generator runs as a single batch request server-side, so per-document
// completion isn't observable. Estimate progress from elapsed time instead.
const EST_SECONDS_PER_DOC = 8
type DraftDeliveryMode = 'save' | 'download'

function computeGenerationDiff(priorNames: string[], generated: string[]) {
  const prior = new Set(priorNames)
  const next = new Set(generated)
  const newDocuments = generated.filter(name => !prior.has(name))
  const replacedDocuments = generated.filter(name => prior.has(name))
  const unchanged = priorNames.filter(name => !next.has(name))
  return { newDocuments, replacedDocuments, unchangedPrior: unchanged }
}

function generationStatusCopy(elapsedSeconds: number, mode: DraftDeliveryMode): string {
  if (elapsedSeconds < 10) return 'Building documents from the saved design sheet…'
  if (elapsedSeconds < 30) return 'Assembling Word files with Massachusetts provisions…'
  if (mode === 'download') {
    if (elapsedSeconds < 60) return 'Packaging selected documents into a ZIP download…'
    return 'Still working — generation can take 60+ seconds for full plans. Please keep this tab open.'
  }
  if (elapsedSeconds < 60) return 'Uploading drafts to secure storage… Larger document sets can take a minute.'
  return 'Still working — generation can take 60+ seconds for full plans. Please keep this tab open.'
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizePreflightResponse(value: unknown, matterId: string): DraftPreflight {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const documents = Array.isArray(raw.documentsToGenerate)
    ? raw.documentsToGenerate
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map(item => ({
          packageName: typeof item.packageName === 'string' ? item.packageName : '',
          title: typeof item.title === 'string' ? item.title : 'Document',
          filename: typeof item.filename === 'string' ? item.filename : 'document.docx',
        }))
    : []
  return {
    matterId: typeof raw.matterId === 'string' ? raw.matterId : matterId,
    designSheetId: typeof raw.designSheetId === 'string' ? raw.designSheetId : null,
    engine: 'node',
    canGenerate: raw.canGenerate === true,
    packageNames: stringArray(raw.packageNames),
    documentsToGenerate: documents,
    unsupportedDocumentLabels: stringArray(raw.unsupportedDocumentLabels),
    fallbackPackageNames: stringArray(raw.fallbackPackageNames),
    missing: stringArray(raw.missing),
    warnings: stringArray(raw.warnings),
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}

interface GenerateStepProps {
  matterId: string
  hubMatter: DraftingHubMatter | null
  sourcePreview: {
    matter: PipelineMatter
    sheet: DesignSheet | null
    contacts: MatterContact[]
    intakeSnapshot: IntakeSnapshot | null
  }
  onAdvance: () => void
}

function sourceStatus(value: boolean) {
  return value ? 'Ready' : 'Missing'
}

export default function GenerateStep({ matterId, hubMatter, sourcePreview, onAdvance }: GenerateStepProps) {
  const router = useRouter()
  const accessToken = useAccessToken()
  const [, startTransition] = useTransition()
  const [result, setResult] = useState<DraftResult | null>(null)
  const [preflight, setPreflight] = useState<DraftPreflight | null>(null)
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [deliveryMode, setDeliveryMode] = useState<DraftDeliveryMode>('save')
  const [busy, setBusy] = useState<'preflight' | 'generate' | null>(null)
  const [generatingDocs, setGeneratingDocs] = useState<DraftPreflightDocument[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [cachedZip, setCachedZip] = useState<CachedDraftZip | null>(null)
  // Pending generation awaiting "Generate anyway" confirmation (missing fields).
  const [confirmGenerate, setConfirmGenerate] = useState<
    { documentsToSave: string[]; docsBeingGenerated: DraftPreflightDocument[]; mode: DraftDeliveryMode } | null
  >(null)

  const isGenerating = busy === 'generate'
  useEffect(() => {
    setCachedZip(loadDraftZipDownload(matterId))
  }, [matterId])

  // Auto-run preflight when the step opens so generating is one click, not
  // "Run Preflight" then Generate. Manual re-runs stay available.
  const autoPreflightRan = useRef(false)
  useEffect(() => {
    if (autoPreflightRan.current || !accessToken || !hubMatter?.designSheet) return
    autoPreflightRan.current = true
    handlePreflight({ quiet: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, hubMatter?.designSheet])

  useEffect(() => {
    if (!isGenerating) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [isGenerating])

  if (!hubMatter) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Drafting data for this matter isn&apos;t loaded yet. Refresh the page.
      </div>
    )
  }

  const hasDesignSheet = !!hubMatter.designSheet
  const canGenerate =
    hasDesignSheet &&
    hubMatter.includedDocumentLabels.length > 0
  const authReady = Boolean(accessToken)
  const preflightReady = preflight?.matterId === matterId
  const selectedCount = preflight
    ? preflight.documentsToGenerate.filter(d => selectedDocs.has(d.filename)).length
    : 0

  const toggleDoc = (filename: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }
  const toggleAllDocs = () => {
    if (!preflight) return
    const all = preflight.documentsToGenerate.map(d => d.filename)
    setSelectedDocs(selectedCount === all.length ? new Set() : new Set(all))
  }

  const handleClauseOverridesMutated = () => {
    // preflightReady is derived from preflight, so clearing this object
    // invalidates both states and prevents generation from using stale results.
    setPreflight(null)
    setSelectedDocs(new Set())
    setResult(null)
  }

  const handlePreflight = (options?: { quiet?: boolean }) => {
    const quiet = options?.quiet === true
    if (busy) return
    if (!accessToken) {
      if (!quiet) toast.error('Your session expired. Refresh and try again.')
      return
    }
    setBusy('preflight')
    setResult(null)
    setPreflight(null)
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/matters/${matterId}/draft/preflight`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const data = await response.json().catch(() => ({})) as { error?: string; detail?: string }
        if (!response.ok) {
          const message = data.detail ?? data.error ?? 'Draft preflight failed.'
          setResult({ success: false, error: message })
          toast.error(message)
          return
        }
        const next = normalizePreflightResponse(data, matterId)
        setPreflight(next)
        setSelectedDocs(new Set(next.documentsToGenerate.map(d => d.filename)))
        if (!next.canGenerate) {
          toast.error(next.error ?? 'Resolve generator issues before saving drafts.')
        } else if (
          next.warnings.length > 0 ||
          next.unsupportedDocumentLabels.length > 0 ||
          next.fallbackPackageNames.length > 0
        ) {
          toast.warning('Review warnings before saving drafts.')
        } else if (!quiet) {
          toast.success('Drafting review ready.')
        }
      } catch {
        toast.error('Network error. Please try again.')
        setResult({ success: false, error: 'Network error.' })
      } finally {
        setBusy(null)
      }
    })
  }

  const handleGenerate = () => {
    if (busy) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    if (!preflightReady || !preflight?.canGenerate) {
      toast.error('Review the draft preflight before saving documents.')
      return
    }
    const documentsToSave = preflight.documentsToGenerate
      .map(d => d.filename)
      .filter(filename => selectedDocs.has(filename))
    if (documentsToSave.length === 0) {
      toast.error('Select at least one document to generate.')
      return
    }
    const docsBeingGenerated = preflight.documentsToGenerate.filter(d => selectedDocs.has(d.filename))

    // Always confirm via the dialog; when required fields are blank it also
    // lists what will be left as [[ MISSING ]].
    setConfirmGenerate({ documentsToSave, docsBeingGenerated, mode: deliveryMode })
  }

  const runGeneration = (documentsToSave: string[], docsBeingGenerated: DraftPreflightDocument[], mode: DraftDeliveryMode) => {
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    setGeneratingDocs(docsBeingGenerated)
    setBusy('generate')
    setResult(null)
    const priorDraftNames = hubMatter?.recentDrafts.map(d => d.name) ?? []
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/matters/${matterId}/draft`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ documents: documentsToSave, mode }),
        })
        if (mode === 'download') {
          if (!response.ok) {
            const data = await response.json().catch(() => ({})) as {
              error?: string
              detail?: string
            }
            const message = data.detail ?? data.error ?? 'Draft download failed.'
            setResult({
              success: false,
              error: message,
              failedDocuments: docsBeingGenerated.map(d => d.title),
            })
            toast.error(`Draft download failed. ${message}`)
            return
          }

          const metaHeader = response.headers.get('X-Draft-Meta')
          const meta = metaHeader ? decodeDraftDownloadMeta(metaHeader) : null
          const blob = await response.blob()
          const disposition = response.headers.get('Content-Disposition') ?? ''
          const filenameMatch = disposition.match(/filename="([^"]+)"/)
          const filename = filenameMatch?.[1] ?? 'drafts.zip'
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = filename
          anchor.click()
          URL.revokeObjectURL(url)

          const base64 = await blobToBase64(blob)
          const cacheEntry: CachedDraftZip = {
            matterId,
            filename,
            savedAt: new Date().toISOString(),
            documentNames: meta?.documents ?? docsBeingGenerated.map(d => d.title),
            base64,
          }
          if (storeDraftZipDownload(cacheEntry)) setCachedZip(cacheEntry)

          const documents = meta?.documents ?? docsBeingGenerated.map(d => d.title)
          const warnings = meta?.warnings ?? []
          const missing = meta?.missing ?? []
          const documentReports = meta?.documentReports ?? []
          const hasBlockingMarkers = meta?.hasBlockingMarkers === true
          const generationDiff = computeGenerationDiff(priorDraftNames, documents)
          setResult({ success: true, documents, warnings, missing, documentReports, hasBlockingMarkers, downloaded: true, generationDiff })
          toast.success(
            documents.length
              ? `Downloaded ${documents.length} draft document${documents.length === 1 ? '' : 's'}`
              : 'Draft documents downloaded',
            documents.length ? { description: filename } : undefined,
          )
          if (hasBlockingMarkers) {
            const flagged = documentReports.filter(r => r.markerCount > 0).length
            toast.warning(
              `${flagged} draft${flagged === 1 ? '' : 's'} contain unresolved markers.`,
              { description: 'Review the files before sharing with the client.' },
            )
          } else if (warnings.length > 0 || missing.length > 0) {
            toast.warning('Drafts downloaded with review warnings.')
          }
          setPreflight(null)
          return
        }

        const data = await response.json().catch(() => ({})) as {
          error?: string
          detail?: string
          documents?: string[]
          missing?: string[]
          warnings?: string[]
          documentReports?: DocumentReport[]
          hasBlockingMarkers?: boolean
        }
        const warnings = Array.isArray(data.warnings) ? data.warnings : []
        const missing = Array.isArray(data.missing) ? data.missing : []
        const documentReports = Array.isArray(data.documentReports) ? data.documentReports : []
        const hasBlockingMarkers = data.hasBlockingMarkers === true
        if (!response.ok) {
          const message = data.detail ?? data.error ?? 'Draft generation failed.'
          // The generator runs as one batch, so a failure means none of the
          // selected documents were saved.
          setResult({
            success: false,
            error: message,
            failedDocuments: docsBeingGenerated.map(d => d.title),
          })
          toast.error(`Draft generation failed — no documents were saved. ${message}`)
          return
        }
        const documents = data.documents ?? []
        const generationDiff = computeGenerationDiff(priorDraftNames, documents)
        setResult({ success: true, documents, warnings, missing, documentReports, hasBlockingMarkers, downloaded: false, generationDiff })
        void logMatterActivity(matterId, 'draft_generated', 'AI drafts generated', {
          detail: documents.length > 0
            ? `Generated ${documents.length} draft document${documents.length === 1 ? '' : 's'}: ${documents.join(', ')}`
            : 'Generated draft documents',
          metadata: { documents },
        })
        toast.success(
          documents.length
            ? `Generated ${documents.length} draft document${documents.length === 1 ? '' : 's'}`
            : 'Draft documents generated',
          documents.length ? { description: documents.join(' · ') } : undefined,
        )
        if (documents.length < documentsToSave.length) {
          const notGenerated = documentsToSave.length - documents.length
          toast.warning(`${notGenerated} selected document${notGenerated === 1 ? ' was' : 's were'} not generated. You can re-run generation from this step.`)
        }
        if (hasBlockingMarkers) {
          const flagged = documentReports.filter(r => r.markerCount > 0).length
          toast.warning(
            `${flagged} draft${flagged === 1 ? '' : 's'} contain unresolved markers — not ready to share.`,
            { description: 'Fix the flagged documents before moving them to Review.' },
          )
        } else if (warnings.length > 0 || missing.length > 0) {
          toast.warning('Drafts generated with review warnings.')
        }
        setPreflight(null)
        router.refresh()
        onAdvance()
      } catch {
        toast.error('Network error. Please try again.')
        setResult({
          success: false,
          error: 'Network error.',
          failedDocuments: docsBeingGenerated.map(d => d.title),
        })
      } finally {
        setBusy(null)
        setGeneratingDocs([])
      }
    })
  }

  const simulatedCompleted = isGenerating
    ? Math.min(generatingDocs.length, Math.max(0, Math.floor((elapsed + EST_SECONDS_PER_DOC / 2) / EST_SECONDS_PER_DOC)))
    : 0

  return (
    <div className="guided-interview space-y-4">
      <section style={guidedCardStyle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium" style={{ color: 'var(--gi-heading)' }}>Draft source data</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These records feed the document payload before the generator runs.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px]">R2 drafts stay internal</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Matter details</p>
            <p className="mt-1 text-sm font-medium">{sourcePreview.matter.client_name || 'Unnamed client'}</p>
            <p className="text-xs text-muted-foreground">
              {sourcePreview.matter.matter_name || 'Matter'} · {sourcePreview.matter.practice_area || 'Practice area missing'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Design sheet</p>
            <p className="mt-1 text-sm font-medium">{sourceStatus(Boolean(sourcePreview.sheet?.id))}</p>
            <p className="text-xs text-muted-foreground">
              {sourcePreview.sheet ? `Version ${sourcePreview.sheet.version} · ${sourcePreview.sheet.status}` : 'Complete or save the design sheet before drafting'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Client intake</p>
            <p className="mt-1 text-sm font-medium">{sourceStatus(Boolean(sourcePreview.intakeSnapshot))}</p>
            <p className="text-xs text-muted-foreground">
              {sourcePreview.intakeSnapshot?.email || 'No linked intake email'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Contacts & fiduciaries</p>
            <p className="mt-1 text-sm font-medium">{sourcePreview.contacts.length} contact{sourcePreview.contacts.length === 1 ? '' : 's'}</p>
            <p className="text-xs text-muted-foreground">
              Fiduciary roles and design-sheet slots are merged into generated documents.
            </p>
          </div>
        </div>
      </section>

      <ClauseOverridesPanel matterId={matterId} onMutated={handleClauseOverridesMutated} />

      <section style={guidedCardStyle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium" style={{ color: 'var(--gi-heading)' }}>Generate drafts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the document generator using the saved design sheet data and selected document set.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
              {([
                { value: 'save' as const, label: 'Save to matter' },
                { value: 'download' as const, label: 'Download only' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDeliveryMode(opt.value)}
                  disabled={busy !== null}
                  className={cn(
                    'rounded-md px-3 py-2 text-[12px] transition-all',
                    deliveryMode === opt.value
                      ? 'bg-card font-semibold text-primary shadow-sm'
                      : 'text-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {deliveryMode === 'save'
                ? 'Drafts are stored in the matter and appear on the Review step.'
                : 'Drafts download as a ZIP file and are not saved to this matter.'}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => handlePreflight()}
              disabled={!authReady || !canGenerate || busy !== null}
              variant="outline"
              className="gap-1.5 text-xs"
              title={!authReady ? 'Signing in...' : !canGenerate ? 'Complete design sheet and document selections first' : 'Check source data before generating drafts'}
            >
              {busy === 'preflight' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {busy === 'preflight' ? 'Checking…' : !authReady ? 'Signing in…' : preflightReady ? 'Re-run preflight' : 'Run Preflight'}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!authReady || !preflightReady || !preflight?.canGenerate || selectedCount === 0 || busy !== null}
              className="gap-1.5 bg-brand-navy text-xs text-white hover:bg-brand-navy/90"
              title={!authReady ? 'Signing in...' : preflightReady && selectedCount === 0 ? 'Select at least one document to generate' : undefined}
            >
              {busy === 'generate' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : deliveryMode === 'download' ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {busy === 'generate'
                ? deliveryMode === 'download' ? 'Downloading…' : 'Saving…'
                : preflightReady && selectedCount > 0
                  ? deliveryMode === 'download'
                    ? `Download ${selectedCount} Draft${selectedCount === 1 ? '' : 's'}`
                    : `Save ${selectedCount} Draft${selectedCount === 1 ? '' : 's'}`
                  : deliveryMode === 'download' ? 'Download Drafts' : 'Save Drafts'}
            </Button>
          </div>
        </div>

        {cachedZip && !isGenerating && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Last ZIP download: {cachedZip.documentNames.length} document{cachedZip.documentNames.length === 1 ? '' : 's'} · {formatDate(cachedZip.savedAt)}
            </p>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => downloadCachedZip(cachedZip)}>
              <Download className="h-3 w-3" />
              Download again
            </Button>
          </div>
        )}

        {isGenerating && generatingDocs.length > 0 && (
          <div className="mt-4 rounded-md border border-accent/20 bg-accent/5 p-4 text-sm" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                <p className="font-semibold">
                  Generating document {Math.min(simulatedCompleted + 1, generatingDocs.length)} of {generatingDocs.length}…
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                {formatElapsed(elapsed)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.round((simulatedCompleted / generatingDocs.length) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{generationStatusCopy(elapsed, deliveryMode)}</p>
            <div className="mt-3 grid gap-1.5 md:grid-cols-2">
              {generatingDocs.map((d, index) => {
                const done = index < simulatedCompleted
                const active = index === simulatedCompleted
                return (
                  <div
                    key={`${d.packageName}-${d.filename}`}
                    className={cn(
                      'flex items-center gap-2 rounded border bg-background px-3 py-2',
                      done ? 'border-success/30' : active ? 'border-accent/40' : 'border-border',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Loader2 className={cn('h-3.5 w-3.5 shrink-0', active ? 'animate-spin text-accent' : 'text-muted-foreground/50')} />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{d.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{d.filename}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {result && (
          <div className={cn(
            'mt-4 flex items-start gap-3 rounded-md border p-3 text-sm',
            result.success && !result.hasBlockingMarkers
              ? 'border-success/20 bg-success/10 text-success'
              : 'border-destructive/20 bg-destructive/10 text-destructive',
          )}>
            {result.success && !result.hasBlockingMarkers
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            {result.success ? (
              <div className="flex-1">
                {result.hasBlockingMarkers ? (
                  <>
                    {(() => {
                      const flagged = result.documentReports.filter(r => r.markerCount > 0)
                      return (
                        <>
                          <p className="font-semibold">
                            {result.downloaded ? 'Downloaded, but' : 'Saved, but'} {flagged.length} document{flagged.length === 1 ? '' : 's'} need review before sharing
                          </p>
                          <p className="mt-0.5 text-xs">
                            These contain unresolved markers — <code>[TODO:]</code> clause text, <code>[[ MISSING ]]</code> fields,
                            or leftover template tags. Do not share them with the client until they are fixed.
                          </p>
                          <div className="mt-2 space-y-1">
                            {flagged.map(r => (
                              <div key={r.name} className="rounded border border-destructive/20 bg-background/50 px-2 py-1 text-xs">
                                <span className="font-medium">{r.name}</span>
                                <span className="opacity-80"> — {markerSummary(r)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      {result.downloaded ? 'Documents downloaded successfully' : 'Documents drafted successfully'}
                    </p>
                    {result.generationDiff && (result.generationDiff.newDocuments.length > 0 || result.generationDiff.replacedDocuments.length > 0) && (
                      <div className="mt-1 space-y-0.5 text-xs opacity-90">
                        {result.generationDiff.newDocuments.length > 0 && (
                          <p>New: {result.generationDiff.newDocuments.join(' · ')}</p>
                        )}
                        {result.generationDiff.replacedDocuments.length > 0 && (
                          <p>Regenerated: {result.generationDiff.replacedDocuments.join(' · ')}</p>
                        )}
                      </div>
                    )}
                    {result.documents.length > 0 && !result.generationDiff && (
                      <p className="mt-0.5 text-xs opacity-80">{result.documents.join(' · ')}</p>
                    )}
                  </>
                )}
                {(result.warnings.length > 0 || result.missing.length > 0) && (
                  <div className="mt-2 space-y-1 rounded border border-warning/20 bg-warning/10 p-2 text-xs text-warning">
                    {result.warnings.map(w => <p key={w}>{w}</p>)}
                    {result.missing.length > 0 && <p>Fields left blank — marked <code>[[ MISSING ]]</code> in the draft: {result.missing.join(', ')}</p>}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1">
                <p>{result.error}</p>
                {result.failedDocuments && result.failedDocuments.length > 0 && (
                  <p className="mt-1 text-xs opacity-80">
                    Not generated: {result.failedDocuments.join(' · ')}
                  </p>
                )}
              </div>
            )}
            <button onClick={() => setResult(null)} className="text-current/60 hover:text-current" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!isGenerating && preflightReady && preflight && (
          <div className={cn(
            'mt-4 rounded-md border p-4 text-sm',
            preflight.canGenerate ? 'border-accent/20 bg-accent/5' : 'border-destructive/20 bg-destructive/10',
          )}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {preflight.canGenerate ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  <p className="font-semibold">Preflight Review</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedCount} of {preflight.documentsToGenerate.length} document{preflight.documentsToGenerate.length === 1 ? '' : 's'} selected.
                </p>
              </div>
              <Badge variant="outline" className="text-[11px]">{preflight.engine}</Badge>
            </div>
            {preflight.documentsToGenerate.length > 0 && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">Choose documents to generate</p>
                  <button
                    type="button"
                    onClick={toggleAllDocs}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    {selectedCount === preflight.documentsToGenerate.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {preflight.documentsToGenerate.map(d => {
                    const checked = selectedDocs.has(d.filename)
                    return (
                      <label
                        key={`${d.packageName}-${d.filename}`}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded border bg-background px-3 py-2 transition-colors',
                          checked ? 'border-accent/40' : 'border-border opacity-70',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleDoc(d.filename)}
                          className="mt-0.5"
                          aria-label={`Generate ${d.title}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{d.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{d.filename}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
            {preflight.missing.length > 0 && (
              <div className="mt-3 rounded border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-semibold text-warning">
                  {preflight.missing.length} field{preflight.missing.length === 1 ? '' : 's'} blank — will render as <code>[[ MISSING ]]</code>
                </p>
                <ul className="mt-2 space-y-1">
                  {preflight.missing.map(fieldPath => {
                    const target = designTargetForMissingField(fieldPath)
                    const focus = `${target.sectionId}:${target.targetField ?? ''}`
                    return (
                      <li key={fieldPath} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{target.label}</span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">{target.sectionLabel ?? target.sectionId}</span>
                        </span>
                        <Link
                          href={`/admin/drafting/${matterId}?step=design&focus=${encodeURIComponent(focus)}`}
                          className="shrink-0 font-medium text-accent hover:underline"
                        >
                          Fix →
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {(preflight.error || preflight.warnings.length > 0 || preflight.unsupportedDocumentLabels.length > 0) && (
              <div className="mt-3 space-y-1 rounded border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                {preflight.error && <p className="font-semibold">{preflight.error}</p>}
                {preflight.warnings.map(w => <p key={w}>{w}</p>)}
                {preflight.unsupportedDocumentLabels.map(l => <p key={l}>Not generated yet: {l}</p>)}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Readiness</h3>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            <ReadinessCard
              label="Design Sheet"
              value={hubMatter.designSheet ? (hubMatter.designSheet.status ?? 'Draft') : 'Missing'}
              hint={hubMatter.designSheet?.updatedAt ? `Updated ${formatDate(hubMatter.designSheet.updatedAt)}` : 'Required before drafting'}
              warn={!hubMatter.designSheet}
            />
            <ReadinessCard
              label="Documents"
              value={`${hubMatter.includedDocumentLabels.length} included`}
              hint={`${hubMatter.selectedTemplateCount} selected template${hubMatter.selectedTemplateCount === 1 ? '' : 's'}`}
              warn={hubMatter.includedDocumentLabels.length === 0}
            />
          </div>
          {(!hasDesignSheet || hubMatter.includedDocumentLabels.length === 0) && (
            <div className="border-t border-border px-4 py-3">
              <div className="flex gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Complete before drafting</p>
                  <p className="mt-1">
                    {[
                      !hasDesignSheet && 'Design sheet',
                      hubMatter.includedDocumentLabels.length === 0 && 'Document selections',
                    ].filter(Boolean).join(', ')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Included Documents</h3>
          </div>
          <div className="space-y-2 p-4">
            {hubMatter.includedDocumentLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents selected. <Link href={`/admin/drafting/${matterId}?step=design`} className="text-accent hover:underline">Open design sheet →</Link></p>
            ) : (
              hubMatter.includedDocumentLabels.map(label => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span>{label}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <AlertDialog open={confirmGenerate !== null} onOpenChange={open => { if (!open) setConfirmGenerate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(preflight?.missing.length ?? 0) > 0
                ? `Generate anyway — ${preflight?.missing.length ?? 0} field${(preflight?.missing.length ?? 0) === 1 ? '' : 's'} blank?`
                : confirmGenerate?.mode === 'download'
                  ? `Download ${confirmGenerate?.documentsToSave.length ?? 0} draft${(confirmGenerate?.documentsToSave.length ?? 0) === 1 ? '' : 's'} as a ZIP?`
                  : `Generate ${confirmGenerate?.documentsToSave.length ?? 0} draft${(confirmGenerate?.documentsToSave.length ?? 0) === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(preflight?.missing.length ?? 0) > 0
                ? <>These fields are empty and will render as <code>[[ MISSING ]]</code> in the draft. You can fix them first, or generate now and fill them in later.</>
                : confirmGenerate?.mode === 'download'
                  ? 'Nothing will be saved to this matter — the drafts download to your computer as a ZIP file.'
                  : 'Drafts are saved to this matter as internal Word documents. Finished files can be shared with the client after attorney review.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preflight && preflight.missing.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-xs">
              {preflight.missing.map(fieldPath => {
                const target = designTargetForMissingField(fieldPath)
                return (
                  <li key={fieldPath}>
                    <span className="font-medium">{target.label}</span>
                    <span className="ml-1.5 text-muted-foreground">{target.sectionLabel}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{(preflight?.missing.length ?? 0) > 0 ? 'Go back & fix' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ctx = confirmGenerate
                setConfirmGenerate(null)
                if (ctx) runGeneration(ctx.documentsToSave, ctx.docsBeingGenerated, ctx.mode)
              }}
            >
              {(preflight?.missing.length ?? 0) > 0
                ? confirmGenerate?.mode === 'download'
                  ? 'Download with [[ MISSING ]] markers'
                  : 'Generate with [[ MISSING ]] markers'
                : confirmGenerate?.mode === 'download'
                  ? 'Download ZIP'
                  : 'Generate drafts'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ReadinessCard({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className={cn(
      'rounded-md border bg-background p-3',
      warn ? 'border-warning/30' : 'border-border',
    )}>
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}
