'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, FilePenLine, FileText, ListChecks, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { canSendReviewedRevision, engagementStep, ENGAGEMENT_STEPS } from './workspaceState'
import { EngagementClauseEditor } from './EngagementClauseEditor'

type Step = typeof ENGAGEMENT_STEPS[number]
type Clause = {
  id?: string | null
  title: string
  text: string
  source: 'library' | 'ai' | 'manual'
  aiProvenance?: { mode: 'draft' | 'revise'; acceptedAt: string } | null
}
type EngagementInput = {
  practiceArea: string
  clientMode: 'individual' | 'couple'
  agreementDate: string
  primary: { name: string; email: string }
  spouse: { name: string; email: string } | null
  legalPlan: string | null
  fee: { amount: number; paymentTerms: string }
  scopeKey: string
  optionalClauseKeys: string[]
  additionalClauses?: Clause[]
  scheduleAClauses?: Clause[]
  emailMessage: string
  expirationHours: number
}
type Agreement = {
  id: string
  status: string
  active_revision: {
    id: string
    render_sha256: string
    input_snapshot: EngagementInput
    render_snapshot?: { docxBase64?: string; pdfBase64?: string } | null
  }
  recipients: Array<{ id: string; name: string; status: string }>
}
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
  const [input, setInput] = useState<EngagementInput>(agreement.active_revision.input_snapshot)
  const [preview, setPreview] = useState<PreviewPayload | null>(() => previewFromActiveRevision(agreement))
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [approvalToken, setApprovalToken] = useState('')
  const [confirmExactRevision, setConfirmExactRevision] = useState(false)
  const [message, setMessage] = useState('')

  const revision = preview?.revision?.id ?? agreement.active_revision.id
  const sha = preview?.sha256 ?? agreement.active_revision.render_sha256
  const blockers = useMemo(() => {
    const missing = [
      !input.primary?.name && 'Primary signer name',
      !input.primary?.email && 'Primary signer email',
      input.clientMode === 'couple' && !input.spouse?.name && 'Spouse name',
      input.clientMode === 'couple' && !input.spouse?.email && 'Spouse email',
      !input.agreementDate && 'Agreement date',
      !(input.fee?.amount > 0) && 'Flat fee',
      !input.fee?.paymentTerms && 'Payment terms',
    ]
    return missing.filter(Boolean) as string[]
  }, [input])
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
        return
      }
      setPreview(body)
      setApprovalToken('')
      setConfirmExactRevision(false)
      setMessage('Engagement agreement generated. Review the exact PDF before sending.')
      setStep('review')
    } catch {
      setMessage('Engagement agreement generation failed.')
    } finally {
      setIsGenerating(false)
    }
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
    <div className="-mx-4 -mb-4 flex min-h-[calc(100vh-7rem)] flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <header className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Engagement agreement</h1>
            <p className="text-xs text-muted-foreground">Estate Planning / Couple</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">Engagement drafting workspace</Badge>
            <Badge variant={locked ? 'secondary' : 'outline'} className="text-[11px]">Status: {agreement.status}</Badge>
          </div>
        </div>
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto" aria-label="Engagement drafting steps">
          {ENGAGEMENT_STEPS.map((id, index) => {
            const meta = STEP_META[id]
            const Icon = meta.icon
            const active = id === step
            const complete = id === 'design' ? blockers.length === 0 : id === 'generate' ? Boolean(preview) : approvalToken || ['sent', 'viewed', 'partially_signed', 'completed'].includes(agreement.status)
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => setStep(id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors',
                  active ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <span className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                  complete ? 'bg-success/15 text-success' : active ? 'bg-accent text-white' : 'bg-muted text-muted-foreground',
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
          {step === 'design' && (
            <DesignStep
              input={input}
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
              revision={revision}
              sha={sha}
              previewUrls={previewUrls}
              hasPreview={Boolean(preview)}
              approvalToken={approvalToken}
              confirmExactRevision={confirmExactRevision}
              canSend={canSend}
              isApproving={isApproving}
              isSending={isSending}
              onApprove={approve}
              onDownload={download}
              onConfirm={setConfirmExactRevision}
              onGenerate={() => setStep('generate')}
              onSend={send}
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
  locked,
  blockers,
  onPrimary,
  onSpouse,
  onEdit,
  onNext,
}: {
  input: EngagementInput
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
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium">
              Agreement date
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" type="date" value={input.agreementDate} onChange={event => onEdit({ agreementDate: event.target.value })} />
            </label>
            <label className="text-xs font-medium">
              Flat fee
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" type="number" value={input.fee.amount} onChange={event => onEdit({ fee: { ...input.fee, amount: Number(event.target.value) } })} />
            </label>
            <label className="text-xs font-medium">
              Expiration hours
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" type="number" value={input.expirationHours} onChange={event => onEdit({ expirationHours: Number(event.target.value) })} />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium">
              Primary name
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" value={input.primary.name} onChange={event => onPrimary({ name: event.target.value })} />
            </label>
            <label className="text-xs font-medium">
              Primary email
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" value={input.primary.email} onChange={event => onPrimary({ email: event.target.value })} />
            </label>
            <label className="text-xs font-medium">
              Spouse name
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" value={input.spouse?.name ?? ''} onChange={event => onSpouse({ name: event.target.value })} />
            </label>
            <label className="text-xs font-medium">
              Spouse email
              <input disabled={locked} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" value={input.spouse?.email ?? ''} onChange={event => onSpouse({ email: event.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-medium">
            Payment terms
            <textarea disabled={locked} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={input.fee.paymentTerms} onChange={event => onEdit({ fee: { ...input.fee, paymentTerms: event.target.value } })} />
          </label>
          <label className="block text-xs font-medium">
            Email message
            <textarea disabled={locked} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={input.emailMessage} onChange={event => onEdit({ emailMessage: event.target.value })} />
          </label>
          <EngagementClauseEditor label="Additional Clauses" category="additional_clause" value={input.additionalClauses ?? []} disabled={locked} onChange={additionalClauses => onEdit({ additionalClauses })} />
          <EngagementClauseEditor label="Schedule A - Additional Scope Terms" category="schedule_a" value={input.scheduleAClauses ?? []} disabled={locked} onChange={scheduleAClauses => onEdit({ scheduleAClauses })} />
        </div>
        <aside className="space-y-3">
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Supported definition</p>
            <p className="mt-1 text-sm font-semibold">Estate Planning / Couple</p>
            <p className="mt-1 text-xs text-muted-foreground">Standard trust estate plan engagement agreement.</p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Readiness</p>
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
  revision,
  sha,
  previewUrls,
  hasPreview,
  approvalToken,
  confirmExactRevision,
  canSend,
  isApproving,
  isSending,
  onApprove,
  onDownload,
  onConfirm,
  onGenerate,
  onSend,
}: {
  agreement: Agreement
  revision: string
  sha: string
  previewUrls: PreviewUrls | null
  hasPreview: boolean
  approvalToken: string
  confirmExactRevision: boolean
  canSend: boolean
  isApproving: boolean
  isSending: boolean
  onApprove: () => void
  onDownload: (url: string, name: string) => void
  onConfirm: (value: boolean) => void
  onGenerate: () => void
  onSend: () => void
}) {
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
          <Button variant="outline" disabled={!previewUrls} onClick={() => previewUrls && onDownload(previewUrls.docx, 'engagement.docx')}>Download editable DOCX</Button>
          <Button variant="outline" disabled={!previewUrls} onClick={() => previewUrls && onDownload(previewUrls.pdf, 'engagement.pdf')}>Download signing PDF</Button>
          <Button disabled={!hasPreview || isApproving} onClick={onApprove}>{isApproving ? 'Approving...' : approvalToken ? 'Re-approve revision' : 'Approve revision'}</Button>
        </div>
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
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmExactRevision} onChange={event => onConfirm(event.target.checked)} />
            I confirm this exact revision was reviewed.
          </label>
          <Button className="mt-3" disabled={!canSend || isSending} onClick={onSend}>
            {isSending ? 'Sending...' : 'Send for signature'}
          </Button>
        </div>
      </div>
    </section>
  )
}
