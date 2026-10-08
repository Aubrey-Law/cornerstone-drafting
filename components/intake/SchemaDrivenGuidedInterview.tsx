'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { guidedFontClass } from '@/lib/clientFonts'
import { useAutoSave, type SaveStatus } from '@/hooks/useAutoSave'
import { useContacts } from '@/hooks/useContacts'
import { formatSubmissionIssueList, getActiveSteps, getStepIssues, type IntakeRow } from '@/lib/intakeSections'
import { getIntakeReadinessFlags } from '@/lib/intakeReadiness'
import { getLegalReviewFlags } from '@/lib/intakeLegalFlags'
import { intakePlanTypeLabel, normalizeIntakePlanType } from '@/lib/intakePlanType'
import { type DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import {
  getIntakeBlock, getIntakeBlockPersistenceSnapshot, getIntakeAttorneyDocumentInclusions,
  persistIntakeBlockOnLeave, type IntakeBlockId,
} from '@/lib/intake/forms/blockRegistry'
import { GuidedSection } from './GuidedSection'
import { ReviewModal, type GuidedInterviewProps } from './LegacyGuidedInterview'
import { CompiledIntakeSections } from './formEngine/CompiledIntakeSections'
import { AttorneyDocumentsBlock, AttorneyPlanStructureBlock } from './formEngine/blockRenderers'
import { IntakeSectionProgressList } from './IntakeSectionProgressList'
import {
  BrandBar, FlagPill, ProgressRing, guidedCardStyle, guidedIntroCardStyle,
  guidedPageStyle, guidedPrimaryButtonStyle,
} from '@/components/guided'
import { getFirmConfig } from '@/lib/firmConfig'

const FIRM = getFirmConfig()
type Props = GuidedInterviewProps & { compiledForm: CompiledIntakeForm }
function text(data: IntakeRow, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

export default function SchemaDrivenGuidedInterview({ initialData, intakeId, compiledForm, mode = 'client', submitted = false, matterLabel, publicIntakeToken, onAttorneySave }: Props) {
  const router = useRouter()
  const isAttorney = mode === 'attorney'
  const isCollegePrep = compiledForm.key === 'college_prep'
  const [data, setData] = useState<Record<string, unknown>>(() => unpackInitialIntakeData(initialData))
  const dataRef = useRef(data)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [showValidation, setShowValidation] = useState(false)
  const [attorneySaving, setAttorneySaving] = useState<SaveStatus>('idle')
  const { status: saveStatus, debouncedSave, flush, trackForFlush } = useAutoSave(intakeId, 1500, publicIntakeToken)
  const contacts = useContacts(intakeId, { throwOnError: true, publicIntakeToken })
  // A baseline is read-only: opening a hydrated questionnaire must not save it.
  const [blockBaseline] = useState(() => new Map(compiledForm.sections.flatMap((section) => section.items.flatMap((item) =>
    item.kind === 'block' && getIntakeBlock(item.blockId).persistOnLeave
      ? [[item.blockId, getIntakeBlockPersistenceSnapshot(item.blockId, data)] as const] : [],
  ))))
  const savedBlocks = useRef(blockBaseline)
  const inFlight = useRef(new Map<IntakeBlockId, Promise<void>>())

  const evaluate = useCallback((current: IntakeRow) => evaluateCompiledIntakeForm(compiledForm, {
    ...current, intake_track: isCollegePrep ? 'college_prep' : 'estate',
  }), [compiledForm, isCollegePrep])
  const evaluation = useMemo(() => evaluate(data), [evaluate, data])
  // Review remains the existing explicit modal/rail action, rather than a
  // duplicate accordion. All metrics still use the full compiled evaluation.
  const displayEvaluation = useMemo(() => ({ ...evaluation, activeSections: evaluation.activeSections.filter((section) =>
    !section.items.every(({ item }) => item.kind === 'block' && item.blockId === 'review_submit'),
  ) }), [evaluation])
  const selectedDocKeys = useMemo(() => Object.entries(getIntakeAttorneyDocumentInclusions(data))
    .filter(([key, included]) => key !== 'spouse_docs' && included).map(([key]) => key as DesignDocumentKey), [data])
  const attorneySections = isAttorney && !isCollegePrep ? [
    { id: 'plan_structure', title: 'Plan structure', subtitle: data.plan_type ? intakePlanTypeLabel(data.plan_type) : 'Choose a plan type', complete: !!normalizeIntakePlanType(data.plan_type) },
    { id: 'documents', title: "Documents we'll prepare", subtitle: `${selectedDocKeys.length} selected · some added automatically from the plan`, complete: selectedDocKeys.length > 0 },
  ] : []
  const progressItems = [
    ...attorneySections,
    ...displayEvaluation.activeSections.map((section) => ({ id: section.id, title: section.title, complete: section.complete, timeEstimate: section.timeEstimate })),
  ]
  const [openId, setOpenId] = useState(() => progressItems.find((section) => !section.complete)?.id ?? progressItems[0]?.id ?? '')
  const openIdRef = useRef(openId)
  const setOpenSection = useCallback((id: string) => { openIdRef.current = id; setOpenId(id) }, [])
  const update = useCallback((field: string, value: unknown) => {
    if (isAttorney || submitted) return
    const next = { ...dataRef.current, [field]: value }
    dataRef.current = next
    setData(next)
    trackForFlush(next)
    debouncedSave(next)
  }, [isAttorney, submitted, trackForFlush, debouncedSave])
  const persistAttorneyPatch = useCallback(async (patch: { plan_type?: string; document_inclusions?: Record<string, boolean> }) => {
    if (!isAttorney) return
    const next = { ...dataRef.current, ...patch }
    dataRef.current = next
    setData(next)
    if (!onAttorneySave) return
    setAttorneySaving('saving')
    try { await onAttorneySave(patch); setAttorneySaving('saved') }
    catch { setAttorneySaving('error'); toast.error('Could not save your selection. Please try again.') }
  }, [isAttorney, onAttorneySave])

  const persistBlock = useCallback(async (id: IntakeBlockId): Promise<void> => {
    if (isAttorney || submitted) return
    let existing = inFlight.current.get(id)
    while (existing) {
      await existing
      // Another leave/submit waiter may have begun saving the newer snapshot.
      existing = inFlight.current.get(id)
    }
    const current = dataRef.current
    const snapshot = getIntakeBlockPersistenceSnapshot(id, current)
    if (savedBlocks.current.get(id) === snapshot) return
    const pending = persistIntakeBlockOnLeave(id, current, contacts, savedBlocks.current.get(id))
    inFlight.current.set(id, pending)
    try {
      await pending
      savedBlocks.current.set(id, snapshot)
    } finally {
      if (inFlight.current.get(id) === pending) inFlight.current.delete(id)
    }
  }, [isAttorney, submitted, contacts])
  const persistSection = useCallback(async (id: string) => {
    const section = evaluate(dataRef.current).activeSections.find((entry) => entry.id === id)
    for (const { item } of section?.items ?? []) {
      if (item.kind === 'block' && getIntakeBlock(item.blockId).persistOnLeave) await persistBlock(item.blockId)
    }
  }, [evaluate, persistBlock])
  const leaveSection = useCallback((id: string) => {
    void persistSection(id).catch(() => toast.error('We could not save your latest contact changes. Please try again before submitting.'))
  }, [persistSection])
  const toggleSection = useCallback((id: string) => {
    const previous = openIdRef.current
    if (previous) leaveSection(previous)
    setOpenSection(previous === id ? '' : id)
  }, [leaveSection, setOpenSection])
  const selectSection = useCallback((id: string) => {
    toggleSection(id)
    window.setTimeout(() => document.getElementById(`intake-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [toggleSection])
  const continueToNextSection = useCallback((current: string, next: string) => {
    leaveSection(current)
    setOpenSection(next)
    window.setTimeout(() => document.getElementById(`intake-section-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [leaveSection, setOpenSection])

  const legalFlags = useMemo(() => isAttorney ? getLegalReviewFlags(data, data.plan_type) : [], [isAttorney, data])
  const readinessFlags = useMemo(() => isAttorney ? getIntakeReadinessFlags(data) : [], [isAttorney, data])
  const clientName = [text(data, 'first_name'), text(data, 'last_name')].filter(Boolean).join(' ')
  const flagCount = legalFlags.length + readinessFlags.length

  async function handleSubmit() {
    if (isAttorney || submitted || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (publicIntakeToken) headers['X-Intake-Token'] = publicIntakeToken
      else {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) { toast.error('Your session has expired. Please refresh and try again.'); return }
        headers.Authorization = `Bearer ${session.access_token}`
      }
      let stable = false
      for (let attempt = 0; attempt < 5; attempt++) {
        const snapshot = dataRef.current
        // Flush drains hook-owned saves; re-track the current data snapshot so
        // retries and edits made during block persistence stay synchronized.
        trackForFlush(snapshot)
        if (!await flush()) {
          toast.error('We could not save your latest changes. Please try again before submitting.')
          return
        }
        for (const section of evaluate(dataRef.current).activeSections) {
          for (const { item } of section.items) {
            if (item.kind === 'block' && getIntakeBlock(item.blockId).persistOnLeave) await persistBlock(item.blockId)
          }
        }
        if (dataRef.current === snapshot) { stable = true; break }
      }
      if (!stable) { toast.error('Your answers are still changing. Please finish editing and submit again.'); return }
      const submitErrors = evaluate(dataRef.current).submissionErrors
      if (submitErrors.length) {
        setShowValidation(true)
        toast.error('Please complete these required items before submitting.', { description: formatSubmissionIssueList(submitErrors) || undefined })
        setReviewOpen(false)
        setOpenSection(submitErrors[0].sectionId)
        return
      }
      const res = await fetch('/api/intake', { method: 'POST', headers, body: JSON.stringify({ existingId: intakeId, status: 'submitted' }) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Failed to submit questionnaire. Please try again.')
        return
      }
      router.refresh()
    } catch {
      toast.error('We could not save or submit your latest changes. Please try again before submitting.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const portalLink = isAttorney ? null : <Link href="/dashboard" style={{ font: '500 13px/1 var(--gi-sans)', color: 'var(--gi-faint)', textDecoration: 'none' }}>← Back to portal</Link>
  if (submitted && !isAttorney) return (
    <div className={`guided-interview ${guidedFontClass}`} style={{ ...guidedPageStyle, minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <BrandBar saveStatus="saved" actions={portalLink} />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', background: 'var(--gi-amber-bg)', border: '1px solid var(--gi-amber-border)', borderRadius: 14, padding: '22px 26px' }}>
          <Lock size={22} style={{ color: 'var(--gi-amber)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 500, fontSize: 22, color: 'var(--gi-heading)' }}>Thank you{clientName ? `, ${clientName.split(' ')[0]}` : ''}</div>
            <p style={{ font: '400 14px/1.55 var(--gi-sans)', color: 'var(--gi-amber)', margin: '6px 0 0' }}>We&apos;ve received your questionnaire. We look forward to reviewing it with you at our meeting.</p>
          </div>
        </div>
      </div>
    </div>
  )
  return (
    <div className={`guided-interview ${guidedFontClass}`} style={{ ...guidedPageStyle, minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <BrandBar saveStatus={isAttorney ? (attorneySaving === 'idle' ? 'saved' : attorneySaving) : (saveStatus === 'idle' ? 'saved' : saveStatus)} matterLabel={isAttorney ? matterLabel : undefined} actions={portalLink} />
        {!isAttorney && <button type="button" className="gi-progress-mobile" onClick={() => {
          const id = progressItems.find((item) => !item.complete)?.id ?? progressItems[0]?.id
          if (id) window.setTimeout(() => document.getElementById(`intake-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        }}>
          {progressItems.filter((item) => item.complete).length} of {progressItems.length} · ~{evaluation.remainingMinutes} min left
          <span className="gi-progress-mobile-track"><span className="gi-progress-mobile-fill" style={{ width: `${evaluation.percentComplete}%` }} /></span>
        </button>}
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <main style={{ flex: 3, minWidth: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={guidedIntroCardStyle}>
              <ProgressRing pct={evaluation.percentComplete} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontWeight: 500, fontSize: 25, lineHeight: 1.2, color: 'var(--gi-heading)', margin: 0 }}>{isCollegePrep ? 'College Preparation Plan' : `Welcome${!isAttorney && clientName ? `, ${clientName.split(' ')[0]}` : ''}`}</h1>
                <p style={{ font: '400 14px/1.6 var(--gi-sans)', color: 'var(--gi-muted)', margin: '10px 0 0' }}>{isCollegePrep
                  ? 'Every document here is voluntary. The student chooses who receives authority, how much, and for how long — and can revoke any of it at any time. Leave blank anything you would rather discuss at the meeting; your progress saves automatically.'
                  : 'Answer what you can before our meeting — rough answers are fine, and everything is strictly confidential. Your progress saves automatically.'}</p>
              </div>
              {!isAttorney && <div style={{ flexShrink: 0, textAlign: 'right' }}><div style={{ font: '600 18px/1.1 var(--gi-sans)', color: 'var(--gi-teal)' }}>~{evaluation.remainingMinutes} min</div><div style={{ font: '400 11.5px/1.3 var(--gi-sans)', color: 'var(--gi-faint)', marginTop: 3 }}>remaining</div></div>}
            </div>
            {attorneySections.map((section, index) => <GuidedSection key={section.id} id={`intake-section-${section.id}`} number={index + 1} title={section.title} subtitle={section.subtitle} complete={section.complete} open={openId === section.id} onToggle={() => toggleSection(section.id)}>
              {section.id === 'plan_structure'
                ? <AttorneyPlanStructureBlock data={data} update={update} onAttorneySave={persistAttorneyPatch} />
                : <AttorneyDocumentsBlock data={data} update={update} onAttorneySave={persistAttorneyPatch} />}
            </GuidedSection>)}
            <CompiledIntakeSections form={compiledForm} evaluation={displayEvaluation} data={data} update={update} intakeId={intakeId} publicIntakeToken={publicIntakeToken} mode={mode} openId={openId} onToggle={toggleSection} onContinue={isAttorney ? undefined : continueToNextSection} onAttorneySave={isAttorney ? persistAttorneyPatch : undefined} showValidation={showValidation} numberOffset={attorneySections.length} onLastContinue={isAttorney ? undefined : (id) => { leaveSection(id); setOpenSection(''); setReviewOpen(true) }} />
          </main>
          <aside style={{ flex: 1, minWidth: 'min(300px, 100%)', position: 'sticky', top: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isAttorney && <div style={guidedCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><span style={{ font: '600 13px/1 var(--gi-sans)', color: 'var(--gi-ink)' }}>Attorney flags</span><span style={{ font: '700 10px/1 var(--gi-sans)', color: '#fff', background: 'var(--gi-amber)', padding: '2px 7px', borderRadius: 999 }}>{flagCount}</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{legalFlags.map((flag) => <FlagPill key={flag.key} tone={flag.tone} text={flag.text} />)}{readinessFlags.map((flag) => <FlagPill key={flag.key} tone="blue" text={flag.message} />)}{flagCount === 0 && <div style={{ font: '400 12.5px/1.45 var(--gi-sans)', color: 'var(--gi-muted)' }}>No flags yet.</div>}</div>
            </div>}
            {!isAttorney && <>
              <div className="gi-progress-rail"><IntakeSectionProgressList items={progressItems} openId={openId} onSelect={selectSection} /></div>
              <button type="button" onClick={() => setReviewOpen(true)} style={guidedPrimaryButtonStyle}>Review questionnaire →</button>
              <div style={{ font: '400 11.5px/1.4 var(--gi-sans)', color: 'var(--gi-faint)', textAlign: 'center' }}>{FIRM.firmName} · {FIRM.city} · {FIRM.phone}</div>
            </>}
          </aside>
        </div>
      </div>
      {reviewOpen && <ReviewModal reviewSelectors={{ getActiveSteps, getStepIssues }} data={data} title={isCollegePrep ? 'Review your College Preparation Plan intake' : 'Review your estate plan organizer'} intakeId={intakeId} publicIntakeToken={publicIntakeToken} isAttorney={isAttorney} matterLabel={matterLabel} legalFlags={legalFlags} readinessFlags={readinessFlags.map((flag) => flag.message)} selectedDocKeys={selectedDocKeys} submitting={submitting} canSubmit={!isAttorney && !submitted} onEdit={(id) => { setReviewOpen(false); if (id) setOpenSection(id) }} onClose={() => setReviewOpen(false)} onSubmit={handleSubmit} />}
    </div>
  )
}
