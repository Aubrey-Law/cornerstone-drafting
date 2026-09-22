'use client'

import { cloneElement, useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, FilePenLine, FileText, ListChecks, Pencil, Save, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { cn } from '@/lib/utils'
import { canSendReviewedRevision, engagementStep, ENGAGEMENT_STEPS } from './workspaceState'
import { EngagementClauseEditor } from './EngagementClauseEditor'
import { EngagementStatusPanel } from './EngagementStatusPanel'
import { OPTIONAL_SERVICES } from '@/lib/engagement/definitions'
import { engagementTemplateFor, type EngagementTemplate } from '@/lib/engagement/templates'
import { engagementLegalPlanLabel } from '@/lib/engagement/types'
import type { EngagementWorkspaceAgreement as Agreement } from '@/lib/engagement/http'
import type { EngagementInput } from '@/lib/engagement/types'

type Step = typeof ENGAGEMENT_STEPS[number]
type PreviewPayload = {
  revision: { id: string }
  sha256: string
  docxBase64: string
  pdfBase64: string
}
type PreviewUrls = { docx: string; pdf: string }

const STEP_META: Record<Step, { label: string; description: string; icon: typeof FileText }> = {
  design: { label: 'Design', description: 'Client, fee, scope, and clauses', icon: FileText },
  generate: { label: 'Generate', description: 'Render the engagement package', icon: FilePenLine },
  review: { label: 'Review', description: 'Review, approve, and send', icon: ListChecks },
}

function dataUrl(base64: string, type: string) {
  return `data:${type};base64,${base64}`
}

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type })
}

function objectUrl(base64: string, type: string) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return dataUrl(base64, type)
  try {
    return URL.createObjectURL(base64ToBlob(base64, type))
  } catch {
    return dataUrl(base64, type)
  }
}

function revokeObjectUrl(url: string) {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

function download(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

const HAS_BEEN_SENT_STATUSES = [
  'sending', 'sent', 'viewed', 'partially_signed', 'completed', 'cancelled', 'expired',
]

function isLocked(status: string) {
  return ['sending', 'sent', 'viewed', 'partially_signed', 'completed', 'cancelled', 'expired'].includes(status)
}

function previewFromActiveRevision(agreement: Agreement): PreviewPayload | null {
  const snapshot = agreement.active_revision.render_snapshot
  if (
    !snapshot?.pdfBase64 ||
    !snapshot.docxBase64 ||
    !agreement.active_revision.render_sha256 ||
    agreement.active_revision.render_sha256 === 'unrendered'
  ) {
    return null
  }
  return {
    revision: { id: agreement.active_revision.id },
    sha256: agreement.active_revision.render_sha256,
    docxBase64: snapshot.docxBase64,
    pdfBase64: snapshot.pdfBase64,
  }
}

export default function EngagementWorkspace({ agreement }: { agreement: Agreement }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const step = engagementStep(searchParams.get('step'))
  const locked = isLocked(agreement.status)
  // 'sending' is deliberately included: a send that died midway leaves an
  // agreement stuck there, and that is exactly when staff need the controls.
  const hasBeenSent = HAS_BEEN_SENT_STATUSES.includes(agreement.status)
  const [input, setInput] = useState<EngagementInput>(agreement.active_revision.input_snapshot)
  const [preview, setPreview] = useState<PreviewPayload | null>(() => previewFromActiveRevision(agreement))
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isReviewEditing, setIsReviewEditing] = useState(false)
  const [approvalToken, setApprovalToken] = useState('')
  const [confirmExactRevision, setConfirmExactRevision] = useState(false)
  const [message, setMessage] = useState('')

  const revision = preview?.revision?.id ?? agreement.active_revision.id
  const sha = preview?.sha256 ?? agreement.active_revision.render_sha256
  // The master decides what the agreement has to say, so it decides what has to
  // be filled in: a plan-funded letter states no firm fee and asks for none.
  const template = useMemo(() => engagementTemplateFor(input), [input])
  const blockers = useMemo(() => {
    const statesFirmFee = template?.statesFirmFee ?? true
    const missing = [
      !input.primary?.name && 'Primary signer name',
      !input.primary?.email && 'Primary signer email',
      input.clientMode === 'couple' && !input.spouse?.name && 'Spouse name',
      input.clientMode === 'couple' && !input.spouse?.email && 'Spouse email',
      !input.agreementDate && 'Agreement date',
      statesFirmFee && !(input.fee?.amount > 0) && 'Flat fee',
      statesFirmFee && !input.fee?.paymentTerms && 'Payment terms',
    ]
    return missing.filter(Boolean) as string[]
  }, [input, template])
  const canSend = canSendReviewedRevision({ approvalToken, confirmExactRevision, revisionId: revision, pdfSha256: sha })

  useEffect(() => {
    if (!preview?.docxBase64 || !preview.pdfBase64) {
      setPreviewUrls(null)
      return
    }
    const urls = {
      docx: objectUrl(preview.docxBase64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      pdf: objectUrl(preview.pdfBase64, 'application/pdf'),
    }
    setPreviewUrls(urls)
    return () => {
      revokeObjectUrl(urls.docx)
      revokeObjectUrl(urls.pdf)
    }
  }, [preview])

  const setStep = (next: Step) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('step', next)
    router.replace(`?${params.toString()}`)
  }
  const edit = (patch: Partial<EngagementInput>) => {
    if (locked) return
    setInput(value => ({ ...value, ...patch }))
    setPreview(null)
    setApprovalToken('')
    setConfirmExactRevision(false)
  }
  const patchPrimary = (patch: Partial<EngagementInput['primary']>) => edit({ primary: { ...input.primary, ...patch } })
  const patchSpouse = (patch: Partial<NonNullable<EngagementInput['spouse']>>) => {
    const spouse = input.spouse ?? { name: '', email: '' }
    edit({ spouse: { ...spouse, ...patch } })
  }

  async function generate() {
    setIsGenerating(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/engagement-agreements/${agreement.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await response.json()
      if (!response.ok) {
        setMessage(body.error ?? 'Engagement agreement generation failed.')
        return false
      }
      setPreview(body)
      setApprovalToken('')
      setConfirmExactRevision(false)
      setMessage('Engagement agreement generated. Review the exact PDF before sending.')
      setStep('review')
      return true
    } catch {
      setMessage('Engagement agreement generation failed.')
      return false
    } finally {
      setIsGenerating(false)
    }
  }

  async function saveReviewRevision() {
    const ok = await generate()
    if (ok) setIsReviewEditing(false)
  }

  async function approve() {
    setIsApproving(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/engagement-agreements/${agreement.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId: revision, pdfSha256: sha }),
      })
      const body = await response.json()
      if (!response.ok) {
        setMessage(body.error ?? 'Could not approve this revision.')
        return
      }
      setApprovalToken(body.approvalToken)
      setMessage('Exact revision approved.')
    } finally {
      setIsApproving(false)
    }
  }

  async function send() {
    setIsSending(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/engagement-agreements/${agreement.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalToken, confirmExactRevision, revisionId: revision, pdfSha256: sha }),
      })
      const body = await response.json()
      setMessage(response.ok ? `Sent request ${body.requestId}` : body.error ?? 'Could not send engagement agreement.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="-mx-4 -mb-4 flex min-h-[calc(100vh-7rem)] flex-col bg-background text-compact text-foreground md:-mx-6 md:-mb-6">
      <header className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Engagement agreement</h1>
            <p className="text-xs text-muted-foreground">{definitionSummary(input, template)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-micro">Engagement drafting workspace</Badge>
            <Badge variant={locked ? 'secondary' : 'outline'} className="text-micro">Status: {agreement.status}</Badge>
          </div>
        </div>
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto" aria-label="Engagement drafting steps">
          {ENGAGEMENT_STEPS.map((id, index) => {
            const meta = STEP_META[id]
            const Icon = meta.icon
            const active = id === step
            const complete = id === 'design'
              ? blockers.length === 0
              : id === 'generate'
                ? Boolean(preview)
                : Boolean(approvalToken) || ['sent', 'viewed', 'partially_signed', 'completed'].includes(agreement.status)
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => setStep(id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors',
                  active ? 'border-selected-border bg-selected text-selected-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-micro font-semibold',
                  complete ? 'bg-success/15 text-success' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                  {complete ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                </span>
                <Icon className="h-3.5 w-3.5" />
                <span>{meta.label}</span>
              </button>
            )
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {/* Once an agreement is out with a client, where it stands matters
              more than the drafting steps above it, so the status panel leads. */}
          {hasBeenSent && <EngagementStatusPanel agreementId={agreement.id} />}
          {step === 'design' && (
            <DesignStep
              input={input}
              template={template}
              locked={locked}
              blockers={blockers}
              onPrimary={patchPrimary}
              onSpouse={patchSpouse}
              onEdit={edit}
              onNext={() => setStep('generate')}
            />
          )}
          {step === 'generate' && (
            <GenerateStep
              blockers={blockers}
              preview={preview}
              isGenerating={isGenerating}
              onBack={() => setStep('design')}
              onGenerate={generate}
              onReview={() => setStep('review')}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              agreement={agreement}
              input={input}
              template={template}
              locked={locked}
              blockers={blockers}
              revision={revision}
              sha={sha}
              previewUrls={previewUrls}
              hasPreview={Boolean(preview)}
              approvalToken={approvalToken}
              confirmExactRevision={confirmExactRevision}
              canSend={canSend}
              isEditing={isReviewEditing}
              isApproving={isApproving}
              isGenerating={isGenerating}
              isSending={isSending}
              onApprove={approve}
              onDownload={download}
              onEdit={edit}
              onPrimary={patchPrimary}
              onSpouse={patchSpouse}
              onConfirm={setConfirmExactRevision}
              onGenerate={() => setStep('generate')}
              onSaveRevision={saveReviewRevision}
              onSend={send}
              onToggleEdit={() => setIsReviewEditing(value => !value)}
            />
          )}
          {message && <p className="rounded-md border border-border bg-card p-3 text-sm">{message}</p>}
        </div>
      </main>
    </div>
  )
}

function DesignStep({
  input,
  template,
  locked,
  blockers,
  onPrimary,
  onSpouse,
  onEdit,
  onNext,
}: {
  input: EngagementInput
  template: EngagementTemplate | null
  locked: boolean
  blockers: string[]
  onPrimary: (patch: Partial<EngagementInput['primary']>) => void
  onSpouse: (patch: Partial<NonNullable<EngagementInput['spouse']>>) => void
  onEdit: (patch: Partial<EngagementInput>) => void
  onNext: () => void
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Design</h2>
        <p className="text-xs text-muted-foreground">Define the signers, fee terms, scope, and agreement clauses.</p>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_280px]">
        <EngagementFieldsEditor
          input={input}
          template={template}
          locked={locked}
          onEdit={onEdit}
          onPrimary={onPrimary}
          onSpouse={onSpouse}
        />
        <aside className="space-y-3">
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-micro font-medium uppercase text-muted-foreground">Supported definition</p>
            <p className="mt-1 text-sm font-semibold">{definitionSummary(input, template)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {template ? template.label : 'No engagement master covers this definition.'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-micro font-medium uppercase text-muted-foreground">Readiness</p>
            {blockers.length ? (
              <ul className="mt-2 space-y-1 text-xs text-destructive">
                {blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-success">Ready to generate.</p>
            )}
          </div>
          <Button className="w-full" disabled={blockers.length > 0} onClick={onNext}>Continue to Generate</Button>
        </aside>
      </div>
    </section>
  )
}

function GenerateStep({
  blockers,
  preview,
  isGenerating,
  onBack,
  onGenerate,
  onReview,
}: {
  blockers: string[]
  preview: PreviewPayload | null
  isGenerating: boolean
  onBack: () => void
  onGenerate: () => void
  onReview: () => void
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Generate</h2>
        <p className="text-xs text-muted-foreground">Render the editable DOCX and signing PDF from the saved engagement design.</p>
      </div>
      <div className="space-y-4 p-4">
        {blockers.length > 0 ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            Resolve design blockers before generating: {blockers.join(', ')}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-background p-4">
            <p className="text-sm font-medium">Ready to generate engagement agreement drafts.</p>
            <p className="mt-1 text-xs text-muted-foreground">Generation creates a new exact revision and invalidates any prior approval.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>Back to Design</Button>
          <Button disabled={blockers.length > 0 || isGenerating} onClick={onGenerate}>
            {isGenerating ? 'Generating...' : preview ? 'Regenerate agreement' : 'Generate agreement'}
          </Button>
          <Button variant="outline" disabled={!preview} onClick={onReview}>Review generated agreement</Button>
        </div>
      </div>
    </section>
  )
}

function ReviewStep({
  agreement,
  input,
  template,
  locked,
  blockers,
  revision,
  sha,
  previewUrls,
  hasPreview,
  approvalToken,
  confirmExactRevision,
  canSend,
  isEditing,
  isApproving,
  isGenerating,
  isSending,
  onApprove,
  onDownload,
  onEdit,
  onPrimary,
  onSpouse,
  onConfirm,
  onGenerate,
  onSaveRevision,
  onSend,
  onToggleEdit,
}: {
  agreement: Agreement
  input: EngagementInput
  template: EngagementTemplate | null
  locked: boolean
  blockers: string[]
  revision: string
  sha: string
  previewUrls: PreviewUrls | null
  hasPreview: boolean
  approvalToken: string
  confirmExactRevision: boolean
  canSend: boolean
  isEditing: boolean
  isApproving: boolean
  isGenerating: boolean
  isSending: boolean
  onApprove: () => void
  onDownload: (url: string, name: string) => void
  onEdit: (patch: Partial<EngagementInput>) => void
  onPrimary: (patch: Partial<EngagementInput['primary']>) => void
  onSpouse: (patch: Partial<NonNullable<EngagementInput['spouse']>>) => void
  onConfirm: (value: boolean) => void
  onGenerate: () => void
  onSaveRevision: () => void
  onSend: () => void
  onToggleEdit: () => void
}) {
  const confirmId = useId()
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Review</h2>
        <p className="text-xs text-muted-foreground">Review the exact signing PDF, approve the revision, then send for signature.</p>
      </div>
      <div className="space-y-4 p-4">
        {!hasPreview && (
          <div className="rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
            Generate an engagement agreement before review.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onGenerate}>{hasPreview ? 'Regenerate' : 'Go to Generate'}</Button>
          <Button variant={isEditing ? 'secondary' : 'outline'} disabled={locked} onClick={onToggleEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            {isEditing ? 'Close in-app editor' : 'Edit in app'}
          </Button>
          <Button variant="outline" disabled={!previewUrls} onClick={() => previewUrls && onDownload(previewUrls.docx, 'engagement.docx')}>Download editable DOCX</Button>
          <Button variant="outline" disabled={!previewUrls} onClick={() => previewUrls && onDownload(previewUrls.pdf, 'engagement.pdf')}>Download signing PDF</Button>
          <Button disabled={!hasPreview || isApproving} onClick={onApprove}>{isApproving ? 'Approving...' : approvalToken ? 'Re-approve revision' : 'Approve revision'}</Button>
        </div>
        {isEditing && (
          <ReviewEditor
            input={input}
            template={template}
            locked={locked}
            blockers={blockers}
            isGenerating={isGenerating}
            onEdit={onEdit}
            onPrimary={onPrimary}
            onSpouse={onSpouse}
            onSaveRevision={onSaveRevision}
          />
        )}
        <p className="font-mono text-xs text-muted-foreground">Revision {revision} / PDF SHA-256 {sha}</p>
        {previewUrls && <iframe title="Engagement agreement PDF preview" src={previewUrls.pdf} className="h-[720px] w-full rounded-md border border-border bg-background" />}
        <div className="rounded-md border border-border bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Send className="h-4 w-4" />
            Send for signature
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {agreement.recipients.map(recipient => `${recipient.name}: ${recipient.status}`).join(' · ') || `Overall: ${agreement.status}`}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Checkbox id={confirmId} checked={confirmExactRevision} onCheckedChange={checked => onConfirm(checked === true)} />
            <Label htmlFor={confirmId} className="text-sm font-normal">I confirm this exact revision was reviewed.</Label>
          </div>
          <Button className="mt-3" disabled={!canSend || isSending} onClick={onSend}>
            {isSending ? 'Sending...' : 'Send for signature'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function ReviewEditor({
  input,
  template,
  locked,
  blockers,
  isGenerating,
  onEdit,
  onPrimary,
  onSpouse,
  onSaveRevision,
}: {
  input: EngagementInput
  template: EngagementTemplate | null
  locked: boolean
  blockers: string[]
  isGenerating: boolean
  onEdit: (patch: Partial<EngagementInput>) => void
  onPrimary: (patch: Partial<EngagementInput['primary']>) => void
  onSpouse: (patch: Partial<NonNullable<EngagementInput['spouse']>>) => void
  onSaveRevision: () => void
}) {
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">In-app DOCX editor</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Edit the generated agreement sections, then save a new exact DOCX/PDF revision before approval.
          </p>
        </div>
        <Button disabled={locked || blockers.length > 0 || isGenerating} onClick={onSaveRevision}>
          <Save className="mr-2 h-4 w-4" />
          {isGenerating ? 'Saving revised version...' : 'Save revised version'}
        </Button>
      </div>
      {blockers.length > 0 && (
        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          Resolve required fields before saving: {blockers.join(', ')}
        </div>
      )}
      <div className="mt-4">
        <EngagementFieldsEditor
          input={input}
          template={template}
          locked={locked}
          onEdit={onEdit}
          onPrimary={onPrimary}
          onSpouse={onSpouse}
        />
      </div>
    </div>
  )
}

function EngagementField({
  label,
  children,
}: {
  label: string
  children: ReactElement<{ id?: string }>
}) {
  const controlId = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={controlId} className="text-xs">{label}</Label>
      {cloneElement(children, { id: children.props.id ?? controlId })}
    </div>
  )
}

// Single source for the engagement input fields — rendered by both the Design
// step and the Review step's in-app editor so the two never drift apart.
function EngagementFieldsEditor({
  input,
  template,
  locked,
  onEdit,
  onPrimary,
  onSpouse,
}: {
  input: EngagementInput
  template: EngagementTemplate | null
  locked: boolean
  onEdit: (patch: Partial<EngagementInput>) => void
  onPrimary: (patch: Partial<EngagementInput['primary']>) => void
  onSpouse: (patch: Partial<NonNullable<EngagementInput['spouse']>>) => void
}) {
  const statesFirmFee = template?.statesFirmFee ?? true
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <EngagementField label="Agreement date">
          <Input disabled={locked} type="date" value={input.agreementDate} onChange={event => onEdit({ agreementDate: event.target.value })} />
        </EngagementField>
        <EngagementField label={statesFirmFee ? 'Flat fee' : 'Quoted fee (not stated in the letter)'}>
          <Input disabled={locked} type="number" value={input.fee.amount} onChange={event => onEdit({ fee: { ...input.fee, amount: Number(event.target.value) } })} />
        </EngagementField>
        <EngagementField label="Expiration hours">
          <Input disabled={locked} type="number" value={input.expirationHours} onChange={event => onEdit({ expirationHours: Number(event.target.value) })} />
        </EngagementField>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <EngagementField label="Primary name">
          <Input disabled={locked} value={input.primary.name} onChange={event => onPrimary({ name: event.target.value })} />
        </EngagementField>
        <EngagementField label="Primary email">
          <Input disabled={locked} type="email" value={input.primary.email} onChange={event => onPrimary({ email: event.target.value })} />
        </EngagementField>
        {/* A solo agreement has one signature line, so a spouse typed here
            would have nowhere to sign and nothing to be named in. */}
        {input.clientMode === 'couple' && (
          <>
            <EngagementField label="Spouse name">
              <Input disabled={locked} value={input.spouse?.name ?? ''} onChange={event => onSpouse({ name: event.target.value })} />
            </EngagementField>
            <EngagementField label="Spouse email">
              <Input disabled={locked} type="email" value={input.spouse?.email ?? ''} onChange={event => onSpouse({ email: event.target.value })} />
            </EngagementField>
          </>
        )}
      </div>
      {statesFirmFee ? (
        <EngagementField label="Payment terms">
          <Textarea disabled={locked} className="min-h-24" value={input.fee.paymentTerms} onChange={event => onEdit({ fee: { ...input.fee, paymentTerms: event.target.value } })} />
        </EngagementField>
      ) : (
        <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
          The fee for the covered services is the amount the {input.legalPlan ? engagementLegalPlanLabel(input.legalPlan) : 'legal'} plan&apos;s
          attorney fee schedule pays, claimed from the plan directly. The letter states no firm fee or payment terms.
          Change the plan on the record&apos;s Billing tab, not here.
        </p>
      )}
      <OptionalServicesEditor input={input} template={template} locked={locked} onEdit={onEdit} />
      <EngagementField label="Email message">
        <ResizableTextarea handleLabel="Resize the email message" disabled={locked} className="min-h-24" value={input.emailMessage} onChange={event => onEdit({ emailMessage: event.target.value })} />
      </EngagementField>
      <EngagementClauseEditor label="Additional Clauses" category="additional_clause" value={input.additionalClauses ?? []} disabled={locked} onChange={additionalClauses => onEdit({ additionalClauses })} />
      <EngagementClauseEditor label="Schedule A - Additional Scope Terms" category="schedule_a" value={input.scheduleAClauses ?? []} disabled={locked} onChange={scheduleAClauses => onEdit({ scheduleAClauses })} />
    </div>
  )
}

/**
 * The elected optional services. They are marked here rather than by the
 * signer: the e-sign anchors are signature and date only, so the agreement goes
 * out with the boxes already set and the signature adopts them.
 */
function OptionalServicesEditor({
  input,
  template,
  locked,
  onEdit,
}: {
  input: EngagementInput
  template: EngagementTemplate | null
  locked: boolean
  onEdit: (patch: Partial<EngagementInput>) => void
}) {
  // The master prints the addendum, so it decides which services exist to elect.
  const keys = template?.optionalServiceKeys ?? []
  if (keys.length === 0) return null
  const elected = input.optionalClauseKeys ?? []
  const toggle = (key: string, checked: boolean) => onEdit({
    optionalClauseKeys: checked ? [...elected, key] : elected.filter(value => value !== key),
  })
  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="font-medium">Optional services</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Checked services are added to the scope in the agreement&apos;s Optional Services addendum, which states each fee.
      </p>
      <div className="mt-3 space-y-2">
        {keys.map(key => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              disabled={locked}
              checked={elected.includes(key)}
              onCheckedChange={checked => toggle(key, checked === true)}
            />
            {OPTIONAL_SERVICES[key]?.label ?? key}
          </label>
        ))}
      </div>
    </div>
  )
}

/** What this agreement is, in the words staff use for it. */
function definitionSummary(input: EngagementInput, template: EngagementTemplate | null): string {
  if (!template) return 'Unsupported definition'
  const area = template.practiceArea === 'EP-LP' ? 'Estate Planning - LP' : 'Estate Planning'
  const mode = template.clientMode === 'couple' ? 'Couple' : 'Individual'
  const plan = input.legalPlan ? ` / ${engagementLegalPlanLabel(input.legalPlan)}` : ''
  return `${area} / ${mode}${plan}`
}
