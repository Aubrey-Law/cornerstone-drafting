'use client'

import Link from 'next/link'
import { Loader2, Upload, FileText, Download } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { fiduciaryReviewTitle } from '@/lib/sharedFields/reviewDisplay'
import {
  getActiveSteps,
  getStepIssues,
  type IntakeRow,
} from '@/lib/intakeSections'
import { collegePrepReviewSections } from '@/lib/collegePrepReview'
import {
  fiduciaryLabel,
  reviewRows,
  summarizeAssetTotals,
  summarizeItemList,
  summarizeRealEstate,
  type AdditionalContactEntry,
  type ChildEntry,
  type FiduciaryEntry,
} from '@/lib/intake/portalReviewSections'
import { getIntakeTrack } from '@/lib/intakeTrack'
import {
  INTAKE_DOCUMENT_KIND_LABELS,
  type IntakeDocumentKind,
  type IntakeDocumentRow,
} from '@/lib/intake/intakeDocumentColumns'
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/documentUpload'

const ACCEPT_ATTR = '.pdf,.doc,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.tif,.tiff'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function EditControl({
  sectionId,
  onEditSection,
}: {
  sectionId: string
  onEditSection?: (sectionId: string) => void
}) {
  if (onEditSection) {
    return (
      <button
        type="button"
        onClick={() => onEditSection(sectionId)}
        className="text-xs font-medium text-accent hover:underline"
      >
        Edit
      </button>
    )
  }
  return (
    <Link href={`/intake/${sectionId}`} className="text-xs font-medium text-accent hover:underline">
      Edit
    </Link>
  )
}

export function IntakeDocumentUpload({
  intakeId,
  kind,
  label,
  publicIntakeToken,
  disabled = false,
}: {
  intakeId: string
  kind: IntakeDocumentKind
  label: string
  publicIntakeToken?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploads, setUploads] = useState<IntakeDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const firmEmail = process.env.NEXT_PUBLIC_FIRM_EMAIL ?? 'scott@aubreylegal.com'

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (publicIntakeToken) return { 'X-Intake-Token': publicIntakeToken }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return { Authorization: `Bearer ${session.access_token}` }
  }, [publicIntakeToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const headers = await authHeaders()
        const res = await fetch(
          `/api/intake/documents?intakeId=${encodeURIComponent(intakeId)}&kind=${encodeURIComponent(kind)}`,
          { headers },
        )
        if (!res.ok) throw new Error('Could not load uploads')
        const body = await res.json() as { documents?: IntakeDocumentRow[] }
        if (!cancelled) setUploads(body.documents ?? [])
      } catch {
        if (!cancelled) setUploads([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authHeaders, intakeId, kind])

  function uploadOne(file: File): Promise<IntakeDocumentRow> {
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          const headers = await authHeaders()
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/intake/documents')
          for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value)
          }
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
          }
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
              try {
                const body = JSON.parse(xhr.responseText) as { error?: string }
                reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`))
              }
              return
            }
            try {
              const body = JSON.parse(xhr.responseText) as { document: IntakeDocumentRow }
              resolve(body.document)
            } catch {
              reject(new Error('Invalid upload response'))
            }
          }
          xhr.onerror = () => reject(new Error('Network error during upload'))
          const form = new FormData()
          form.append('intakeId', intakeId)
          form.append('kind', kind)
          form.append('file', file)
          xhr.send(form)
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Upload failed'))
        }
      })()
    })
  }

  async function handleFiles(files: FileList | null) {
    if (disabled || !files?.length) return
    setUploading(true)
    setProgress(0)
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name}: file is larger than ${formatSize(MAX_UPLOAD_BYTES)}.`)
        continue
      }
      if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
        toast.error(`${file.name}: file type not accepted.`)
        continue
      }
      try {
        const doc = await uploadOne(file)
        setUploads((prev) => [doc, ...prev])
        toast.success(`${file.name} uploaded`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `${file.name}: upload failed`)
      }
    }
    setProgress(null)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-info/20 bg-info/10 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Share copies of your {label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Upload here, email to{' '}
          <a href={`mailto:${firmEmail}`} className="font-medium underline">{firmEmail}</a>
          , or bring printed copies to your meeting.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { if (!disabled) inputRef.current?.click() }}
          disabled={disabled || uploading || loading}
          className="inline-flex items-center gap-2 rounded-md border border-accent bg-card px-3 py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload files'}
        </button>
        <span className="text-xs text-muted-foreground">
          PDF, Word, Excel, images — {formatSize(MAX_UPLOAD_BYTES)} max per file
        </span>
        <input
          ref={inputRef}
          type="file"
          disabled={disabled || uploading}
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {progress !== null && (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-info/20">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
        </div>
      )}

      {loading && (
        <p className="text-xs text-muted-foreground">Loading uploads…</p>
      )}

      {!loading && uploads.length > 0 && (
        <ul className="space-y-1">
          {uploads.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded border border-info/20 bg-card px-3 py-1.5 text-xs text-foreground"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <span className="flex-1 truncate">{doc.name}</span>
              <span className="shrink-0 text-muted-foreground/70">{formatSize(doc.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const VALID_INTAKE_DOC_KINDS = new Set<IntakeDocumentKind>([
  'general',
  'existing_plan',
  'divorce_settlement',
  'gift_tax_return',
])

function IntakeReviewUploadSummary({
  intakeId,
  publicIntakeToken,
  onEditSection,
}: {
  intakeId: string
  publicIntakeToken?: string
  onEditSection?: (sectionId: string) => void
}) {
  const [uploads, setUploads] = useState<IntakeDocumentRow[]>([])
  const [loading, setLoading] = useState(true)

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (publicIntakeToken) return { 'X-Intake-Token': publicIntakeToken }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return { Authorization: `Bearer ${session.access_token}` }
  }, [publicIntakeToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const headers = await authHeaders()
        const res = await fetch(
          `/api/intake/documents?intakeId=${encodeURIComponent(intakeId)}`,
          { headers },
        )
        if (!res.ok) throw new Error('Could not load uploads')
        const body = await res.json() as { documents?: IntakeDocumentRow[] }
        if (!cancelled) setUploads(body.documents ?? [])
      } catch {
        if (!cancelled) setUploads([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authHeaders, intakeId])

  if (loading || uploads.length === 0) return null

  const grouped = uploads.reduce<Partial<Record<IntakeDocumentKind, IntakeDocumentRow[]>>>((acc, doc) => {
    const kind = (VALID_INTAKE_DOC_KINDS.has(doc.kind as IntakeDocumentKind)
      ? doc.kind
      : 'general') as IntakeDocumentKind
    acc[kind] = [...(acc[kind] ?? []), doc]
    return acc
  }, {})

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">Documents uploaded</h4>
        <EditControl sectionId="goals" onEditSection={onEditSection} />
      </div>
      <div className="space-y-3">
        {(Object.entries(grouped) as [IntakeDocumentKind, IntakeDocumentRow[]][]).map(([kind, docs]) => (
          <div key={kind}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {INTAKE_DOCUMENT_KIND_LABELS[kind]}
            </p>
            <ul className="mt-1 space-y-1">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 truncate">{doc.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground/70">{formatSize(doc.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface IntakeQuestionnaireReviewProps {
  data: Record<string, unknown>
  onEditSection?: (sectionId: string) => void
  className?: string
  intakeId?: string
  publicIntakeToken?: string
}

export function IntakeQuestionnaireReview({
  data,
  onEditSection,
  className,
  intakeId,
  publicIntakeToken,
}: IntakeQuestionnaireReviewProps) {
  const [exporting, setExporting] = useState(false)

  const exportAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (publicIntakeToken) return { 'X-Intake-Token': publicIntakeToken }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return { Authorization: `Bearer ${session.access_token}` }
  }, [publicIntakeToken])

  // Downloads the same answers this screen shows, as a Word document the
  // client can keep. Available before submit too: the point is to have a copy
  // of what was entered, not a receipt for having sent it.
  const handleDownloadAnswers = useCallback(async () => {
    if (!intakeId) return
    setExporting(true)
    try {
      const headers = await exportAuthHeaders()
      const response = await fetch(`/api/intake/${intakeId}/export`, { headers })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Could not download your answers')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'my-intake.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download your answers')
    } finally {
      setExporting(false)
    }
  }, [exportAuthHeaders, intakeId])

  const isCollegePrep = getIntakeTrack(data) === 'college_prep'
  const reviewSteps = getActiveSteps(data as IntakeRow).filter((step) => step.id !== 'review')
  const checklist = reviewSteps.map((step) => {
    const issues = getStepIssues(step.id, data as IntakeRow)
    const errors = issues.filter((item) => item.severity === 'error')
    const warnings = issues.filter((item) => item.severity === 'warning')
    return { step, errors, warnings }
  })

  const spouse = data._spouse as Record<string, string> | undefined
  const children = data._children as ChildEntry[] | undefined
  const additionalNominees = (
    ((data._additional_contacts as AdditionalContactEntry[]) ?? []).filter((r) => {
      const fn = typeof r.first_name === 'string' ? r.first_name.trim() : ''
      const ln = typeof r.last_name === 'string' ? r.last_name.trim() : ''
      return fn.length > 0 || ln.length > 0
    })
  )

  const section = (title: string, sectionId: string, items: [string, string][]) => {
    if (items.length === 0) return null
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <EditControl sectionId={sectionId} onEditSection={onEditSection} />
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {items.map((row) => (
            <div key={row[0]}>
              <dt className="text-muted-foreground">{row[0]}</dt>
              <dd className="font-medium text-foreground">{row[1]}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  const fiduciarySection = (intakeLocalKey: string, sectionId: string) => {
    const title = fiduciaryReviewTitle(intakeLocalKey)
    const entries = data[intakeLocalKey] as FiduciaryEntry[] | undefined
    const namedEntries = (entries ?? []).filter((entry) => entry.first_name?.trim() || entry.last_name?.trim())
    if (namedEntries.length === 0) return null
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <EditControl sectionId={sectionId} onEditSection={onEditSection} />
        </div>
        {namedEntries.map((e, i) => (
          <div key={i} className="mb-2 text-sm">
            <span className="text-xs uppercase text-muted-foreground">{fiduciaryLabel(e)}:</span>{' '}
            <span className="font-medium text-foreground">{e.first_name} {e.last_name}</span>
            {e.relationship && <span className="text-muted-foreground"> ({e.relationship})</span>}
          </div>
        ))}
      </div>
    )
  }

  const obj = (data.planning_objectives as Record<string, string> | undefined) ?? {}
  const referralSource = data.referral_source as string | undefined

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isCollegePrep
            ? 'This is a summary of everything entered in the College Preparation Plan questionnaire. Review each section together and edit anything that needs updating before submitting.'
            : 'This is your estate plan organizer — a summary of everything you entered in the questionnaire. Review each section and edit anything that needs updating before submitting.'}
        </p>
        {intakeId && (
          <button
            type="button"
            onClick={() => void handleDownloadAnswers()}
            disabled={exporting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {exporting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Download className="h-3.5 w-3.5" aria-hidden />}
            {exporting ? 'Preparing…' : 'Download a copy (Word)'}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">Submission checklist</h4>
        <div className="space-y-2">
          {checklist.map(({ step, errors, warnings }) => {
            const hasErrors = errors.length > 0
            const hasWarnings = warnings.length > 0
            const optionalDone = step.optional && step.isComplete(data as IntakeRow)
            return (
              <div key={step.id} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  {onEditSection ? (
                    <button
                      type="button"
                      onClick={() => onEditSection(step.id)}
                      className="text-left text-sm font-medium text-foreground hover:underline"
                    >
                      {step.title}
                    </button>
                  ) : (
                    <Link href={`/intake/${step.id}`} className="text-sm font-medium text-foreground hover:underline">
                      {step.title}
                    </Link>
                  )}
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-micro font-medium uppercase tracking-wide',
                      step.optional
                        ? optionalDone
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                        : hasErrors
                          ? 'bg-destructive/10 text-destructive'
                          : hasWarnings
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success',
                    )}
                  >
                    {step.optional ? optionalDone ? 'Complete' : 'Optional' : hasErrors ? 'Needs info' : hasWarnings ? 'Review' : 'Complete'}
                  </span>
                </div>
                {(hasErrors || hasWarnings) && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {[...errors, ...warnings].map((issue, index) => (
                      <li key={`${issue.message}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!isCollegePrep && referralSource && section('Getting Started', 'referral', reviewRows([
        ['referral_source', referralSource],
        ['referral_name', data.referral_name],
        ['legal_insurance_plan', data.legal_insurance_plan],
        ['legal_insurance_member_id', data.legal_insurance_member_id],
      ]))}

      {section(
        isCollegePrep ? 'Student Information' : 'Personal Information',
        isCollegePrep ? 'cp_student' : 'personal',
        reviewRows([
        ['client_name', `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim()],
        ['preferred_name', data.preferred_name],
        ['date_of_birth', data.date_of_birth],
        ['email', data.email],
        ['phone', data.phone],
        ['address', [data.street_address, data.city, data.state, data.zip].filter(Boolean).join(', ')],
        ['county', data.county],
        ['is_us_citizen', data.is_us_citizen],
      ]))}

      {!isCollegePrep && section('Family', 'family', reviewRows([
        ['marital_status', data.marital_status],
        ['has_children', data.has_children],
        ['has_minor_children', data.has_minor_children],
      ]))}

      {!isCollegePrep && spouse && section('Spouse', 'spouse', reviewRows([
        ['spouse_name', `${spouse.first_name ?? ''} ${spouse.last_name ?? ''}`.trim()],
        ['spouse_dob', spouse.date_of_birth],
        ['spouse_email', spouse.email],
        ['spouse_phone', spouse.phone],
      ]))}

      {!isCollegePrep && children && children.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">Children</h4>
            <EditControl sectionId="children" onEditSection={onEditSection} />
          </div>
          {children.map((child, i) => (
            <div key={child.id ?? i} className="mb-1 text-sm">
              <span className="font-medium text-foreground">{child.first_name} {child.last_name}</span>
              {child.date_of_birth && <span className="text-muted-foreground"> (DOB: {child.date_of_birth})</span>}
            </div>
          ))}
        </div>
      )}

      {additionalNominees.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">
              {isCollegePrep ? 'Parents & guardians' : 'Additional contacts'}
            </h4>
            <EditControl
              sectionId={isCollegePrep ? 'cp_parents' : 'additional_contacts'}
              onEditSection={onEditSection}
            />
          </div>
          {additionalNominees.map((row, i) => {
            const line =
              composedAddressOneLine({
                street: (row.street ?? '').trim(),
                city: (row.city ?? '').trim(),
                state: (row.state ?? '').trim(),
                zip: (row.zip ?? '').trim(),
              }) ||
              (typeof row.address === 'string' ? row.address.trim() : '')
            return (
              <div key={row.id ?? i} className="mb-2 text-sm">
                <span className="font-medium text-foreground">
                  {row.first_name} {row.last_name}
                </span>
                {row.relationship?.trim() && (
                  <span className="text-muted-foreground"> ({row.relationship.trim()})</span>
                )}
                {(line || row.phone?.trim() || row.email?.trim()) && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[line || null, formatPhoneDisplay(row.phone) || null, row.email?.trim() || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isCollegePrep && collegePrepReviewSections(data).map((cpSection) => (
        <div key={cpSection.sectionId + cpSection.title} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">{cpSection.title}</h4>
            <EditControl sectionId={cpSection.sectionId} onEditSection={onEditSection} />
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {cpSection.rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {!isCollegePrep && section('Financial overview', 'estate', reviewRows([
        ['estate_value', data.estate_value],
        ['asset_types', data.asset_types],
        ['Real estate', summarizeRealEstate(data)],
        ['Bank accounts', summarizeAssetTotals(data, 'bank_accounts')],
        ['Investments', summarizeAssetTotals(data, 'investment_accounts')],
        ['Retirement', summarizeAssetTotals(data, 'retirement_accounts')],
        ['Life insurance', summarizeAssetTotals(data, 'life_insurance')],
        ['Business interests', summarizeItemList(data, 'business_interests', 'business', 'businesses')],
        ['Liabilities', summarizeItemList(data, 'liabilities', 'liability', 'liabilities')],
      ]))}

      {!isCollegePrep && section('Goals & wishes', 'goals', reviewRows([
        ['why_choose_firm', obj.why_choose_firm],
        ['why_now', obj.why_now],
        ['make_things_easy', obj.make_things_easy],
        ['planning_goals', data.planning_goals ?? data.goals],
        ['has_existing_plan', data.has_existing_plan],
        ['has_divorce_settlement', data.has_divorce_settlement],
        ['has_prior_gift_tax', data.has_prior_gift_tax],
        ['special_notes', data.special_notes ?? data.additional_notes],
      ]))}

      {intakeId && (
        <IntakeReviewUploadSummary
          intakeId={intakeId}
          publicIntakeToken={publicIntakeToken}
          onEditSection={onEditSection}
        />
      )}

      {isCollegePrep ? (
        <>
          {fiduciarySection('_fid_poa_client', 'cp_agents')}
          {fiduciarySection('_fid_hcp_client', 'cp_agents')}
        </>
      ) : (
        <>
          {fiduciarySection('_fid_trustee_client', 'fiduciaries')}
          {fiduciarySection('_fid_personal_rep_client', 'fiduciaries')}
          {fiduciarySection('_fid_poa_client', 'fiduciaries')}
          {fiduciarySection('_fid_hcp_client', 'fiduciaries')}

          {data.marital_status === 'married' && (
            <>
              {fiduciarySection('_fid_personal_rep_spouse', 'spouse_fiduciaries')}
              {fiduciarySection('_fid_poa_spouse', 'spouse_fiduciaries')}
              {fiduciarySection('_fid_hcp_spouse', 'spouse_fiduciaries')}
            </>
          )}

          {fiduciarySection('_fid_guardian_client', 'guardian')}
          {fiduciarySection('_fid_excluded_guardian', 'guardian')}
        </>
      )}
    </div>
  )
}
