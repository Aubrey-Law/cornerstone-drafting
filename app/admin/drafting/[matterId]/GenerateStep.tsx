'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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
import { designTargetForMissingField, missingFieldDisplayLabel } from '@/lib/estateGenerator/missingFieldDesignMap'
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
import type { DraftingMetrics } from '@/lib/drafting/metrics'
import { DraftingEfficiency } from '@/components/drafting/DraftingEfficiency'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { DraftRunStatus, type VisibleDraftRun } from '@/components/drafting/DraftRunStatus'
import { stableDraftKey } from '@/lib/drafting/supersede'
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
      documentRefs: Array<{ id: string; name: string }>
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

type DraftPreflightMissingField = {
  path: string
  packageName: string
  subjectKind: 'client' | 'spouse' | 'young-adult'
  subjectName: string | null
}

type DraftPreflight = {
  sourceRevision: string | null
  matterId: string
  designSheetId: string | null
  engine: 'node'
  canGenerate: boolean
  packageNames: string[]
  documentsToGenerate: DraftPreflightDocument[]
  unsupportedDocumentLabels: string[]
  fallbackPackageNames: string[]
  missing: string[]
  missingFields: DraftPreflightMissingField[]
  warnings: string[]
  error?: string
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

type DraftDeliveryMode = 'save' | 'download'

function computeGenerationDiff(priorNames: string[], generated: string[]) {
  const prior = new Set(priorNames.map(stableDraftKey))
  const next = new Set(generated.map(stableDraftKey))
  const newDocuments = generated.filter(name => !prior.has(stableDraftKey(name)))
  const replacedDocuments = generated.filter(name => prior.has(stableDraftKey(name)))
  const unchanged = priorNames.filter(name => !next.has(stableDraftKey(name)))
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

function normalizeMissingFields(value: unknown, fallbackPaths: string[]): DraftPreflightMissingField[] {
  const fields = Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .filter(item => typeof item.path === 'string' && item.path.length > 0)
        .map((item): DraftPreflightMissingField => ({
          path: item.path as string,
          packageName: typeof item.packageName === 'string' ? item.packageName : '',
          subjectKind: item.subjectKind === 'spouse' || item.subjectKind === 'young-adult'
            ? item.subjectKind
            : 'client',
          subjectName: typeof item.subjectName === 'string' && item.subjectName.trim()
            ? item.subjectName
            : null,
        }))
    : []
  if (fields.length > 0) return fields
  // An older API response only carries `missing[]`; keep the checklist working.
  return fallbackPaths.map(path => ({ path, packageName: '', subjectKind: 'client' as const, subjectName: null }))
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
  const missing = stringArray(raw.missing)
  return {
    sourceRevision: typeof raw.sourceRevision === 'string' ? raw.sourceRevision : null,
    matterId: typeof raw.matterId === 'string' ? raw.matterId : matterId,
    designSheetId: typeof raw.designSheetId === 'string' ? raw.designSheetId : null,
    engine: 'node',
    canGenerate: raw.canGenerate === true,
    packageNames: stringArray(raw.packageNames),
    documentsToGenerate: documents,
    unsupportedDocumentLabels: stringArray(raw.unsupportedDocumentLabels),
    fallbackPackageNames: stringArray(raw.fallbackPackageNames),
    missing,
    missingFields: normalizeMissingFields(raw.missingFields, missing),
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
  beforePreflight: () => Promise<boolean>
  onAdvance: () => void
}

function sourceStatus(value: boolean) {
  return value ? 'Ready' : 'Missing'
}

export default function GenerateStep({ matterId, hubMatter, sourcePreview, beforePreflight, onAdvance }: GenerateStepProps) {
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

  const [run, setRun] = useState<VisibleDraftRun | null>(null)
  const [metrics, setMetrics] = useState<DraftingMetrics | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const activeRunId = useRef<string | null>(null)
  const requestBusy = useRef(false)
  const statusRequest = useRef(0)
  const refreshRun = useCallback(async () => {
    if (!accessToken) return
    const request = ++statusRequest.current
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/draft`, { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } })
      const data = await response.json()
      if (request !== statusRequest.current) return
      if (!response.ok) throw new Error(data.error ?? 'Could not load draft run status.')
      setRun(data.run ?? null)
      setMetrics(data.metrics ?? null)
      setRunError(null)
    } catch (error) { if (request === statusRequest.current) setRunError((error as Error).message) }
  }, [accessToken, matterId])
  useEffect(() => { void refreshRun() }, [refreshRun])
  useEffect(() => {
    if (run?.status !== 'running' && busy !== 'generate') return
    const interval = setInterval(() => void refreshRun(), 2000)
    return () => clearInterval(interval)
  }, [run?.status, busy, refreshRun])
  const isGenerating = busy === 'generate' || (run?.status === 'running' && !run.retryable)
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
  const preflightReady = preflight?.matterId === matterId && Boolean(preflight?.sourceRevision)
  const selectedCount = preflight
    ? preflight.documentsToGenerate.filter(d => selectedDocs.has(d.filename)).length
    : 0

  const toggleDoc = (filename: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      try { sessionStorage.setItem(`draft-selection:${matterId}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }
  const toggleAllDocs = () => {
    if (!preflight) return
    const all = preflight.documentsToGenerate.map(d => d.filename)
    const next = selectedCount === all.length ? new Set<string>() : new Set(all)
    setSelectedDocs(next)
    try { sessionStorage.setItem(`draft-selection:${matterId}`, JSON.stringify([...next])) } catch {}
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
        if (!(await beforePreflight())) {
          setResult({ success: false, error: 'Save your latest decisions or resolve the conflict in Design before checking drafts.' })
          return
        }
        const response = await fetch(`/api/admin/matters/${matterId}/draft/preflight`, {
          // Re-runs happen right after the attorney edits the design sheet, so a
          // cached response would keep reporting fields they just filled in.
          cache: 'no-store',
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
        let remembered: string[] | null = null
        try { const stored = sessionStorage.getItem(`draft-selection:${matterId}`); if (stored) remembered = JSON.parse(stored) } catch {}
        const available = next.documentsToGenerate.map(d => d.filename)
        setSelectedDocs(new Set(Array.isArray(remembered) ? remembered.filter(name => available.includes(name)) : available))
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

    if (preflight.missingFields.length > 0) setConfirmGenerate({ documentsToSave, docsBeingGenerated, mode: deliveryMode })
    else runGeneration(documentsToSave, docsBeingGenerated, deliveryMode)
  }

  const runGeneration = (documentsToSave: string[], docsBeingGenerated: DraftPreflightDocument[], mode: DraftDeliveryMode, retry?: VisibleDraftRun) => {
    if (requestBusy.current) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    requestBusy.current = true
    statusRequest.current += 1
    activeRunId.current = retry?.id ?? crypto.randomUUID()
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
          body: JSON.stringify({ documents: retry?.requested_documents ?? documentsToSave, mode, runId: activeRunId.current, sourceRevision: retry?.source_revision ?? preflight?.sourceRevision }),
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
          setResult({ success: true, documents, documentRefs: [], warnings, missing, documentReports, hasBlockingMarkers, downloaded: true, generationDiff })
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
          run?: VisibleDraftRun
          success?: boolean
          error?: string
          detail?: string
          documents?: string[]
          documentRefs?: Array<{ id: string; name: string }>
          missing?: string[]
          warnings?: string[]
          documentReports?: DocumentReport[]
          hasBlockingMarkers?: boolean
        }
        if (data.run) { statusRequest.current += 1; setRun(data.run) }
        if (response.status === 202) return
        const warnings = Array.isArray(data.warnings) ? data.warnings : []
        const missing = Array.isArray(data.missing) ? data.missing : []
        const documentReports = Array.isArray(data.documentReports) ? data.documentReports : []
        const hasBlockingMarkers = data.hasBlockingMarkers === true
        if (!response.ok) {
          const message = data.detail ?? data.error ?? 'Draft generation failed.'
          // Some files may already be saved. The run ledger is authoritative.
          setResult({
            success: false,
            error: message,
            failedDocuments: docsBeingGenerated.map(d => d.title),
          })
          toast.error(`Draft generation needs attention. ${message}`)
          if (response.status === 409) setPreflight(null)
          void refreshRun()
          return
        }
        if (data.run && data.run.status !== 'completed') {
          setResult({ success: false, error: 'Some documents were not saved. Review the run status and retry the remaining documents.' })
          router.refresh()
          return
        }
        const documents = data.documents ?? []
        const documentRefs = Array.isArray(data.documentRefs)
          ? data.documentRefs.filter(
              (reference): reference is { id: string; name: string } =>
                Boolean(reference) && typeof reference.id === 'string' && typeof reference.name === 'string',
            )
          : []
        const generationDiff = computeGenerationDiff(priorDraftNames, documents)
        setResult({ success: true, documents, documentRefs, warnings, missing, documentReports, hasBlockingMarkers, downloaded: false, generationDiff })
        void logMatterActivity(matterId, 'draft_generated', `Generated ${documents.length} drafts`, {
          detail: documents.length > 0
            ? `Generated ${documents.length} draft document${documents.length === 1 ? '' : 's'}: ${documents.join(', ')}`
            : 'Generated draft documents',
          metadata: { documents, documentRefs },
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
        // Keep the result visible until the attorney chooses to review it.
      } catch {
        toast.error('Network error. Please try again.')
        setResult({
          success: false,
          error: 'Network error.',
          failedDocuments: docsBeingGenerated.map(d => d.title),
        })
      } finally {
        requestBusy.current = false
        setBusy(null)
        setGeneratingDocs([])
        if (mode === 'save') void refreshRun()
      }
    })
  }

  return (
    <div className="guided-interview guided-zinc space-y-4">
      {run && <DraftRunStatus run={run} busy={busy !== null} onReview={onAdvance} onRetry={() => runGeneration(run.requested_documents, run.requested_documents.map(filename => ({ filename, title: filename, packageName: '' })), 'save', run)} />}
      {runError && <p role="alert" className="text-sm text-destructive">{runError} <button className="underline" onClick={() => void refreshRun()}>Retry status check</button></p>}
      {metrics && <DraftingEfficiency metrics={metrics} />}
      <details style={guidedCardStyle}>
        <summary className="cursor-pointer text-sm font-medium">Source details</summary>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mt-3 text-base font-medium">Information used for these drafts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Drafts use the saved design decisions, intake, and matter contacts.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px]">Drafts stay internal</Badge>
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
      </details>

      <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Custom clauses</summary><ClauseOverridesPanel matterId={matterId} onMutated={handleClauseOverridesMutated} /></details>

      <section style={guidedCardStyle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium" style={{ color: 'var(--gi-heading)' }}>Generate drafts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Create the selected Word drafts from your saved decisions.
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
              disabled={!authReady || !canGenerate || busy !== null || isGenerating}
              variant="outline"
              className="gap-1.5 text-xs"
              title={!authReady ? 'Signing in...' : !canGenerate ? 'Complete design sheet and document selections first' : 'Check source data before generating drafts'}
            >
              {busy === 'preflight' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {busy === 'preflight' ? 'Checking…' : !authReady ? 'Signing in…' : preflightReady ? 'Check again' : 'Save and check drafts'}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!authReady || !preflightReady || !preflight?.canGenerate || selectedCount === 0 || busy !== null || isGenerating}
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
          <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="font-semibold">
                  Preparing {generatingDocs.length} document{generatingDocs.length === 1 ? '' : 's'}…
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                {formatElapsed(elapsed)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{generationStatusCopy(elapsed, deliveryMode)}</p>
            <div className="mt-3 grid gap-1.5 md:grid-cols-2">
              {generatingDocs.map((d) => {
                const done = run?.outcomes.some(o => o.filename === d.filename && o.status === 'saved') ?? false
                const active = !done
                return (
                  <div
                    key={`${d.packageName}-${d.filename}`}
                    className={cn(
                      'flex items-center gap-2 rounded border bg-background px-3 py-2',
                      done ? 'border-success/30' : active ? 'border-primary/40' : 'border-border',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Loader2 className={cn('h-3.5 w-3.5 shrink-0', active ? 'animate-spin text-primary' : 'text-muted-foreground/50')} />
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
            preflight.canGenerate ? 'border-primary/20 bg-primary/5' : 'border-destructive/20 bg-destructive/10',
          )}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {preflight.canGenerate ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  <p className="font-semibold">Document check</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedCount} of {preflight.documentsToGenerate.length} document{preflight.documentsToGenerate.length === 1 ? '' : 's'} selected.
                </p>
              </div>
            </div>
            {preflight.documentsToGenerate.length > 0 && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">Choose documents to generate</p>
                  <button
                    type="button"
                    onClick={toggleAllDocs}
                    className="text-[11px] font-medium text-primary hover:underline"
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
                          checked ? 'border-primary/40' : 'border-border opacity-70',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleDoc(d.filename)}
                          className="mt-0.5"
                          aria-label={`Generate ${d.title}`}
                        />
                        <span className="min-w-0">
                          <span className="block break-words text-xs font-medium">{d.title}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
            {preflight.missingFields.length > 0 && (
              <div className="mt-3 rounded border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-semibold text-warning">
                  {preflight.missingFields.length} field{preflight.missingFields.length === 1 ? '' : 's'} blank — will render as <code>[[ MISSING ]]</code>
                </p>
                <ul className="mt-2 space-y-1">
                  {preflight.missingFields.map(field => {
                    const target = designTargetForMissingField(field.path)
                    const focus = `${target.sectionId}:${target.targetField ?? ''}`
                    return (
                      <li
                        key={`${field.packageName}:${field.subjectName ?? ''}:${field.path}`}
                        className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">
                            {missingFieldDisplayLabel(target.label, field.subjectKind, field.subjectName)}
                          </span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">{target.sectionLabel ?? target.sectionId}</span>
                        </span>
                        <Link
                          href={`/admin/drafting/${matterId}?step=design&focus=${encodeURIComponent(focus)}`}
                          className="shrink-0 font-medium text-primary hover:underline"
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

      <AlertDialog open={confirmGenerate !== null} onOpenChange={open => { if (!open) setConfirmGenerate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(preflight?.missingFields.length ?? 0) > 0
                ? `Generate anyway — ${preflight?.missingFields.length ?? 0} field${(preflight?.missingFields.length ?? 0) === 1 ? '' : 's'} blank?`
                : confirmGenerate?.mode === 'download'
                  ? `Download ${confirmGenerate?.documentsToSave.length ?? 0} draft${(confirmGenerate?.documentsToSave.length ?? 0) === 1 ? '' : 's'} as a ZIP?`
                  : `Generate ${confirmGenerate?.documentsToSave.length ?? 0} draft${(confirmGenerate?.documentsToSave.length ?? 0) === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(preflight?.missingFields.length ?? 0) > 0
                ? <>These fields are empty and will render as <code>[[ MISSING ]]</code> in the draft. You can fix them first, or generate now and fill them in later.</>
                : confirmGenerate?.mode === 'download'
                  ? 'Nothing will be saved to this matter — the drafts download to your computer as a ZIP file.'
                  : 'Drafts are saved to this matter as internal Word documents. Finished files can be shared with the client after attorney review.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preflight && preflight.missingFields.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-xs">
              {preflight.missingFields.map(field => {
                const target = designTargetForMissingField(field.path)
                return (
                  <li key={`${field.packageName}:${field.subjectName ?? ''}:${field.path}`}>
                    <span className="font-medium">
                      {missingFieldDisplayLabel(target.label, field.subjectKind, field.subjectName)}
                    </span>
                    <span className="ml-1.5 text-muted-foreground">{target.sectionLabel}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{(preflight?.missingFields.length ?? 0) > 0 ? 'Go back & fix' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ctx = confirmGenerate
                setConfirmGenerate(null)
                if (ctx) runGeneration(ctx.documentsToSave, ctx.docsBeingGenerated, ctx.mode)
              }}
            >
              {(preflight?.missingFields.length ?? 0) > 0
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
