'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { guidedFontClass } from '@/lib/clientFonts'
import { useAutoSave, type SaveStatus } from '@/hooks/useAutoSave'
import { useContacts } from '@/hooks/useContacts'
import {
  getActiveSteps,
  getRequiredSteps,
  getStepIssues,
  getSubmissionErrors,
  formatSubmissionIssueList,
  type IntakeRow,
  type IntakeStep,
} from '@/lib/intake/legacySections'
import { getIntakeReadinessFlags } from '@/lib/intakeReadiness'
import { getLegalReviewFlags, type LegalReviewFlag } from '@/lib/intakeLegalFlags'
import {
  INTAKE_PLAN_TYPE_OPTIONS,
  intakePlanTypeLabel,
  intakePlanTypeMapping,
  normalizeIntakePlanType,
} from '@/lib/intakePlanType'
import {
  DESIGN_DOCUMENT_LABELS,
  getDocumentInclusions,
  setDocumentInclusion,
  type DesignDocumentInclusions,
  type DesignDocumentKey,
} from '@/lib/designSheetDocumentInclusions'
import { getIntakeTrack } from '@/lib/intakeTrack'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { GuidedSection } from './GuidedSection'
import { IntakeQuestionnaireReview } from './IntakeQuestionnaireReview'
import {
  IntakeSectionProgressList,
  type IntakeSectionProgressItem,
} from './IntakeSectionProgressList'
import {
  BrandBar,
  DocumentPicker,
  DEFAULT_DOC_GROUPS,
  FlagPill,
  PlanStructurePicker,
  ProgressRing,
  guidedCardStyle,
  guidedIntroCardStyle,
  guidedPageStyle,
  guidedPrimaryButtonStyle,
} from '@/components/guided'
import { getFirmConfig } from '@/lib/firmConfig'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChildEntry, FiduciaryEntry, AdditionalContactEntry, StepProps } from './IntakeWizard'

const stepLoading = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 12, width: 128, borderRadius: 4, background: 'var(--gi-divider)' }} />
        <div style={{ height: 40, borderRadius: 6, background: 'var(--gi-page)' }} />
      </div>
    ))}
  </div>
)

const STEP_COMPONENTS: Record<string, React.ComponentType<StepProps>> = {
  referral: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepReferral), { loading: stepLoading }),
  personal: dynamic<StepProps>(() => import('./IntakePersonalStep').then((m) => m.StepPersonal), { loading: stepLoading }),
  family: dynamic<StepProps>(() => import('./IntakeFamilySteps').then((m) => m.StepFamily), { loading: stepLoading }),
  spouse: dynamic<StepProps>(() => import('./IntakeFamilySteps').then((m) => m.StepSpouse), { loading: stepLoading }),
  children: dynamic<StepProps>(() => import('./IntakeChildrenStep').then((m) => m.StepChildren), { loading: stepLoading }),
  estate: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepEstate), { loading: stepLoading }),
  goals: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepGoals), { loading: stepLoading }),
  additional_contacts: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepAdditionalContacts), { loading: stepLoading }),
  fiduciaries: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepFiduciaries), { loading: stepLoading }),
  spouse_fiduciaries: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepSpouseFiduciaries), { loading: stepLoading }),
  guardian: dynamic<StepProps>(() => import('./IntakeWizard').then((m) => m.StepGuardian), { loading: stepLoading }),
  cp_student: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeStudent), { loading: stepLoading }),
  cp_school: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeSchool), { loading: stepLoading }),
  cp_parents: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeParents), { loading: stepLoading }),
  cp_agents: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeAgents), { loading: stepLoading }),
  cp_dpoa: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeDpoa), { loading: stepLoading }),
  cp_healthcare: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeHealthcare), { loading: stepLoading }),
  cp_hipaa: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeHipaa), { loading: stepLoading }),
  cp_living_will: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeLivingWill), { loading: stepLoading }),
  cp_other: dynamic<StepProps>(() => import('./collegePrep/CollegePrepSteps').then((m) => m.StepCollegeOther), { loading: stepLoading }),
}

const DOC_GROUPS = DEFAULT_DOC_GROUPS

const FIRM = getFirmConfig()

export interface GuidedInterviewProps {
  initialData: Record<string, unknown>
  intakeId: string
  mode?: 'client' | 'attorney'
  submitted?: boolean
  /** Attorney mode only: e.g. "Matter AL-2025-014 · Chen". */
  matterLabel?: string
  publicIntakeToken?: string
  /**
   * Attorney mode only: persist the attorney's plan-structure / document
   * selection. Runs as a server action on the admin-protected page (service
   * client), so it never touches the client-facing `/api/intake` write path.
   */
  onAttorneySave?: (patch: { plan_type?: string; document_inclusions?: Record<string, boolean> }) => Promise<void>
}

function text(data: IntakeRow, key: string): string {
  return typeof data[key] === 'string' ? (data[key] as string).trim() : ''
}

export default function GuidedInterview({
  initialData,
  intakeId,
  mode = 'client',
  submitted = false,
  matterLabel,
  publicIntakeToken,
  onAttorneySave,
}: GuidedInterviewProps) {
  const router = useRouter()
  const isAttorney = mode === 'attorney'
  const [data, setData] = useState<Record<string, unknown>>(() => unpackInitialIntakeData(initialData))
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  const isCollegePrep = getIntakeTrack(data) === 'college_prep'
  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showValidation, setShowValidation] = useState(false)

  const { status: saveStatus, debouncedSave, flush, trackForFlush } = useAutoSave(
    intakeId, 1500, publicIntakeToken,
  )
  const { saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts } = useContacts(intakeId)

  const update = useCallback(
    (field: string, value: unknown) => {
      setData((prev) => {
        const next = { ...prev, [field]: value }
        trackForFlush(next)
        debouncedSave(next)
        return next
      })
    },
    [debouncedSave, trackForFlush],
  )

  // Attorney mode: plan/document edits persist via the injected server action,
  // not the client autosave path.
  const [attorneySaving, setAttorneySaving] = useState<SaveStatus>('idle')
  const persistAttorneyPatch = useCallback(
    async (patch: { plan_type?: string; document_inclusions?: Record<string, boolean> }) => {
      setData((prev) => ({ ...prev, ...patch }))
      if (!onAttorneySave) return
      setAttorneySaving('saving')
      try {
        await onAttorneySave(patch)
        setAttorneySaving('saved')
      } catch {
        setAttorneySaving('error')
        toast.error('Could not save your selection. Please try again.')
      }
    },
    [onAttorneySave],
  )
  const noop = useCallback(() => {}, [])

  const persistContactsForStep = useCallback(
    async (stepId: string, current: Record<string, unknown>) => {
      if (stepId === 'spouse' && current._spouse) {
        await saveSpouse(current._spouse as Record<string, string>)
      }
      if (stepId === 'children' && current._children) {
        await saveChildren(current._children as ChildEntry[])
      }
      // College-prep parents ride the same additional-contacts pipeline, so they
      // land in `contacts` and stay selectable in the agent pickers.
      if (stepId === 'additional_contacts' || stepId === 'cp_parents') {
        await saveAdditionalContacts((current._additional_contacts as AdditionalContactEntry[]) ?? [])
      }
      const fiduciarySteps: Record<string, [string, 'client' | 'spouse'][]> = {
        fiduciaries: [
          ['trustee', 'client'],
          ['personal_rep', 'client'],
          ['poa', 'client'],
          ['hcp', 'client'],
        ],
        spouse_fiduciaries: [
          ['personal_rep', 'spouse'],
          ['poa', 'spouse'],
          ['hcp', 'spouse'],
        ],
        guardian: [['guardian', 'client']],
        cp_agents: [
          ['poa', 'client'],
          ['hcp', 'client'],
        ],
      }
      const roles = fiduciarySteps[stepId]
      if (roles) {
        for (const [role, party] of roles) {
          const key = `_fid_${role}_${party}`
          const entries = current[key] as FiduciaryEntry[] | undefined
          const namedEntries = entries?.filter((e) => e.first_name?.trim() || e.last_name?.trim())
          if (namedEntries && namedEntries.length > 0) {
            await saveFiduciaries(namedEntries, role, party)
          }
        }
      }
    },
    [saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts],
  )

  // ----- derived: sections -----
  const activeSteps = useMemo(() => getActiveSteps(data as IntakeRow), [data])
  const stepSections = useMemo(
    () => activeSteps.filter((s) => s.id !== 'review'),
    [activeSteps],
  )

  type SectionEntry =
    | { kind: 'step'; id: string; step: IntakeStep; complete: boolean }
    | { kind: 'attorney'; id: 'plan_structure' | 'documents'; title: string; subtitle: string; complete: boolean }

  const planType = data.plan_type
  const docInclusions = useMemo<DesignDocumentInclusions>(() => {
    const mapping = intakePlanTypeMapping(planType)
    return getDocumentInclusions({
      plan_type: mapping?.designPlanType ?? null,
      marital_status: text(data, 'marital_status'),
      decisions: { document_inclusions: (data.document_inclusions as Record<string, unknown>) ?? {} },
      children: (data._children as unknown[]) ?? [],
    } as Parameters<typeof getDocumentInclusions>[0])
  }, [planType, data])

  const selectedDocKeys = useMemo(
    () => (Object.keys(docInclusions) as Array<keyof DesignDocumentInclusions>)
      .filter((k) => k !== 'spouse_docs' && docInclusions[k]),
    [docInclusions],
  )

  const sections = useMemo<SectionEntry[]>(() => {
    // The plan-structure picker offers five *estate* structures and the
    // document picker is keyed off them; neither describes a college-prep
    // package, whose document set is fixed.
    const attorneySections: SectionEntry[] = isAttorney && !isCollegePrep
      ? [
          {
            kind: 'attorney',
            id: 'plan_structure',
            title: 'Plan structure',
            subtitle: planType ? intakePlanTypeLabel(planType) : 'Choose a plan type',
            complete: !!normalizeIntakePlanType(planType),
          },
          {
            kind: 'attorney',
            id: 'documents',
            title: "Documents we'll prepare",
            subtitle: `${selectedDocKeys.length} selected · some added automatically from the plan`,
            complete: selectedDocKeys.length > 0,
          },
        ]
      : []
    const steps: SectionEntry[] = stepSections.map((step) => ({
      kind: 'step',
      id: step.id,
      step,
      complete: step.isComplete(data as IntakeRow),
    }))
    return [...attorneySections, ...steps]
  }, [isAttorney, isCollegePrep, planType, selectedDocKeys.length, stepSections, data])

  const [openId, setOpenId] = useState<string>(() => '')
  // Default the open section to the first incomplete one (once).
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current || sections.length === 0) return
    didInit.current = true
    const firstIncomplete = sections.find((s) => !s.complete)
    setOpenId((firstIncomplete ?? sections[0]).id)
  }, [sections])

  const toggleSection = useCallback(
    (id: string) => {
      setOpenId((prevOpen) => {
        // Persist contacts for the section we're leaving.
        if (prevOpen && prevOpen !== id) {
          void persistContactsForStep(prevOpen, dataRef.current)
        }
        return prevOpen === id ? '' : id
      })
    },
    [persistContactsForStep],
  )

  const continueToNextSection = useCallback(
    (currentId: string) => {
      const idx = sections.findIndex((s) => s.id === currentId)
      const next = idx >= 0 ? sections[idx + 1] : undefined
      if (next) {
        void persistContactsForStep(currentId, dataRef.current)
        setOpenId(next.id)
        window.setTimeout(() => {
          document.getElementById(`intake-section-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 50)
      } else {
        setOpenId('')
        setReviewOpen(true)
      }
    },
    [persistContactsForStep, sections],
  )

  function sectionSubtitle(entry: SectionEntry): string | undefined {
    if (entry.kind === 'attorney') return entry.subtitle
    const mins = entry.step.timeEstimate
    const timeLabel = mins === 1 ? '~1 min' : `~${mins} min`
    return `${entry.step.subtitle} · ${timeLabel}`
  }

  // ----- derived: progress -----
  const requiredSteps = useMemo(() => getRequiredSteps(data as IntakeRow), [data])
  const completedRequired = requiredSteps.filter((s) => s.isComplete(data as IntakeRow)).length
  const pct = requiredSteps.length > 0
    ? Math.round((completedRequired / requiredSteps.length) * 100)
    : 0

  // Minutes still to spend: every active step the client hasn't finished.
  // Includes "Review & Submit", which stays outstanding until submission.
  const remainingMinutes = useMemo(
    () => activeSteps
      .filter((s) => !s.isComplete(data as IntakeRow))
      .reduce((sum, s) => sum + (s.timeEstimate ?? 0), 0),
    [activeSteps, data],
  )

  // Rail progress map — same entries, and same order, as the main column.
  const progressItems = useMemo<IntakeSectionProgressItem[]>(
    () => sections.map((entry) => entry.kind === 'step'
      ? { id: entry.id, title: entry.step.title, complete: entry.complete, timeEstimate: entry.step.timeEstimate }
      : { id: entry.id, title: entry.title, complete: entry.complete }),
    [sections],
  )
  const sectionsDone = progressItems.filter((i) => i.complete).length
  const firstIncompleteId = progressItems.find((i) => !i.complete)?.id ?? progressItems[0]?.id ?? ''

  const selectSection = useCallback(
    (id: string) => {
      toggleSection(id)
      window.setTimeout(() => {
        document.getElementById(`intake-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    },
    [toggleSection],
  )

  // ----- derived: summary -----
  const lastName = text(data, 'last_name')
  const clientName = [text(data, 'first_name'), lastName].filter(Boolean).join(' ')

  // ----- derived: flags (attorney) -----
  const legalFlags = useMemo<LegalReviewFlag[]>(
    () => (isAttorney ? getLegalReviewFlags(data as IntakeRow, planType) : []),
    [isAttorney, data, planType],
  )
  const readinessFlags = useMemo(
    () => (isAttorney ? getIntakeReadinessFlags(data as IntakeRow) : []),
    [isAttorney, data],
  )
  const flagCount = legalFlags.length + readinessFlags.length

  // ----- documents (attorney) -----
  const toggleDoc = useCallback(
    (key: DesignDocumentKey, value: boolean) => {
      const current = { decisions: { document_inclusions: (dataRef.current.document_inclusions as Record<string, unknown>) ?? {} } }
      const nextDecisions = setDocumentInclusion(current, key, value)
      void persistAttorneyPatch({ document_inclusions: nextDecisions.document_inclusions as Record<string, boolean> })
    },
    [persistAttorneyPatch],
  )

  // ----- submit -----
  async function handleSubmit() {
    setSubmitting(true)
    try {
      const submitErrors = getSubmissionErrors(dataRef.current as IntakeRow)
      if (submitErrors.length > 0) {
        setShowValidation(true)
        toast.error('Please complete these required items before submitting.', {
          description: formatSubmissionIssueList(submitErrors) || undefined,
        })
        setReviewOpen(false)
        // Open the section holding the first blocking item.
        setOpenId(submitErrors[0].sectionId)
        setSubmitting(false)
        return
      }

      const flushed = await flush()
      if (!flushed) {
        toast.error('We could not save your latest changes. Please try again before submitting.')
        setSubmitting(false)
        return
      }
      if (openId) await persistContactsForStep(openId, dataRef.current)

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (publicIntakeToken) {
        headers['X-Intake-Token'] = publicIntakeToken
      } else {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          toast.error('Your session has expired. Please refresh and try again.')
          setSubmitting(false)
          return
        }
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const res = await fetch('/api/intake', {
        method: 'POST',
        headers,
        body: JSON.stringify({ existingId: intakeId, status: 'submitted' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Failed to submit questionnaire. Please try again.')
        setSubmitting(false)
        return
      }
      router.refresh()
    } catch {
      toast.error('An unexpected error occurred.')
      setSubmitting(false)
    }
  }

  // The questionnaire opens outside the portal shell, so a client needs a way
  // back to the rest of the portal from here.
  const portalLink = isAttorney ? null : (
    <Link
      href="/dashboard"
      style={{ font: '500 13px/1 var(--gi-sans)', color: 'var(--gi-faint)', textDecoration: 'none' }}
    >
      ← Back to portal
    </Link>
  )

  // ===== render: submitted/locked (client) =====
  if (submitted && !isAttorney) {
    return (
      <div className={`guided-interview ${guidedFontClass}`} style={{ ...guidedPageStyle, minHeight: '100vh' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <BrandBar saveStatus="saved" matterLabel={undefined} actions={portalLink} />
          <div style={{
            display: 'flex', gap: 16, alignItems: 'flex-start',
            background: 'var(--gi-amber-bg)', border: '1px solid var(--gi-amber-border)', borderRadius: 14, padding: '22px 26px',
          }}>
            <Lock size={22} style={{ color: 'var(--gi-amber)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 22, color: 'var(--gi-heading)' }}>
                Thank you{clientName ? `, ${clientName.split(' ')[0]}` : ''}
              </div>
              <p style={{ font: '400 14px/1.55 var(--gi-sans)', color: 'var(--gi-amber)', margin: '6px 0 0' }}>
                We&apos;ve received your questionnaire. We look forward to reviewing it with you at our meeting.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== render: main =====
  return (
    <div className={`guided-interview ${guidedFontClass}`} style={{ ...guidedPageStyle, minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <BrandBar
          saveStatus={isAttorney ? (attorneySaving === 'idle' ? 'saved' : attorneySaving) : (saveStatus === 'idle' ? 'saved' : saveStatus)}
          matterLabel={isAttorney ? matterLabel : undefined}
          actions={portalLink}
        />

        {/* Mobile stand-in for the rail's progress card (hidden at lg and up). */}
        {!isAttorney && (
          <button
            type="button"
            className="gi-progress-mobile"
            onClick={() => {
              if (!firstIncompleteId) return
              window.setTimeout(() => {
                document.getElementById(`intake-section-${firstIncompleteId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 50)
            }}
          >
            {sectionsDone} of {progressItems.length} · ~{remainingMinutes} min left
            <span className="gi-progress-mobile-track">
              <span className="gi-progress-mobile-fill" style={{ width: `${pct}%` }} />
            </span>
          </button>
        )}

        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* MAIN */}
          <main style={{ flex: 3, minWidth: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* intro / progress */}
            <div style={guidedIntroCardStyle}>
              <ProgressRing pct={pct} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontWeight: 500, fontSize: 25, lineHeight: 1.2, color: 'var(--gi-heading)', margin: 0 }}>
                  {isCollegePrep
                    ? 'College Preparation Plan'
                    : `Welcome${!isAttorney && clientName ? `, ${clientName.split(' ')[0]}` : ''}`}
                </h1>
                <p style={{ font: '400 14px/1.6 var(--gi-sans)', color: 'var(--gi-muted)', margin: '10px 0 0' }}>
                  {isCollegePrep
                    ? 'Every document here is voluntary. The student chooses who receives authority, how much, and for how long — and can revoke any of it at any time. Leave blank anything you would rather discuss at the meeting; your progress saves automatically.'
                    : 'Answer what you can before our meeting — rough answers are fine, and everything is strictly confidential. Your progress saves automatically.'}
                </p>
              </div>
              {!isAttorney && (
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ font: '600 18px/1.1 var(--gi-sans)', color: 'var(--gi-teal)' }}>
                    ~{remainingMinutes} min
                  </div>
                  <div style={{ font: '400 11.5px/1.3 var(--gi-sans)', color: 'var(--gi-faint)', marginTop: 3 }}>
                    remaining
                  </div>
                </div>
              )}
            </div>

            {/* sections */}
            {sections.map((entry, i) => {
              const number = i + 1
              const nextEntry = sections[i + 1]
              const nextTitle = nextEntry
                ? (nextEntry.kind === 'step' ? nextEntry.step.title : nextEntry.title)
                : null
              // Attorney sections carry no estimate, so the suffix is dropped there.
              const nextMinutes = nextEntry?.kind === 'step' ? nextEntry.step.timeEstimate : undefined
              const continueProps = !isAttorney && openId === entry.id
                ? {
                    onContinue: () => continueToNextSection(entry.id),
                    continueLabel: nextTitle
                      ? `Continue to ${nextTitle}${nextMinutes != null ? ` · ~${nextMinutes} min` : ''}`
                      : 'Review questionnaire',
                  }
                : {}
              if (entry.kind === 'attorney') {
                return (
                  <GuidedSection
                    key={entry.id}
                    id={`intake-section-${entry.id}`}
                    number={number}
                    title={entry.title}
                    subtitle={sectionSubtitle(entry)}
                    complete={entry.complete}
                    open={openId === entry.id}
                    onToggle={() => toggleSection(entry.id)}
                    {...continueProps}
                  >
                    {entry.id === 'plan_structure'
                      ? (
                        <PlanStructurePicker
                          options={INTAKE_PLAN_TYPE_OPTIONS.map((opt) => ({
                            value: opt.value,
                            title: opt.title,
                            sub: opt.sub,
                          }))}
                          selected={normalizeIntakePlanType(planType)}
                          onSelect={(v) => persistAttorneyPatch({ plan_type: v })}
                        />
                      )
                      : <DocumentPicker inclusions={docInclusions} onToggle={toggleDoc} groups={DOC_GROUPS} />}
                  </GuidedSection>
                )
              }
              const StepComp = STEP_COMPONENTS[entry.id]
              const issues = (openId === entry.id && showValidation)
                ? getStepIssues(entry.id, data as IntakeRow)
                : []
              return (
                <GuidedSection
                  key={entry.id}
                  id={`intake-section-${entry.id}`}
                  number={number}
                  title={entry.step.title}
                  subtitle={sectionSubtitle(entry)}
                  complete={entry.complete}
                  open={openId === entry.id}
                  onToggle={() => toggleSection(entry.id)}
                  {...continueProps}
                >
                  {issues.length > 0 && <SectionIssues issues={issues} />}
                  {isAttorney && (
                    <div style={{ marginTop: 14, font: '500 12px/1.4 var(--gi-sans)', color: 'var(--gi-faint)' }}>
                      Client&apos;s answers (read-only). Edit fields from the matter&apos;s intake editor.
                    </div>
                  )}
                  {StepComp && (
                    <div style={isAttorney
                      ? { paddingTop: 14, pointerEvents: 'none', opacity: 0.85 }
                      : { paddingTop: 14 }}>
                      <StepComp
                        data={data}
                        update={isAttorney ? noop : update}
                        intakeId={intakeId}
                        publicIntakeToken={publicIntakeToken}
                      />
                    </div>
                  )}
                </GuidedSection>
              )
            })}
          </main>

          {/* SUMMARY RAIL */}
          {/* min(300px, 100%) — a hard 300px floor cannot shrink inside the
              ~280px content box at 320px viewports, which forced horizontal
              page scroll and clipped this rail (it holds Review & submit). The
              <main> above already uses this pattern. */}
          <aside style={{ flex: 1, minWidth: 'min(300px, 100%)', position: 'sticky', top: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isAttorney && (
              <div style={guidedCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ font: '600 13px/1 var(--gi-sans)', color: 'var(--gi-ink)' }}>Attorney flags</span>
                  <span style={{ font: '700 10px/1 var(--gi-sans)', color: '#fff', background: 'var(--gi-amber)', padding: '2px 7px', borderRadius: 999 }}>{flagCount}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {legalFlags.map((f) => <FlagPill key={f.key} tone={f.tone} text={f.text} />)}
                  {readinessFlags.map((f) => <FlagPill key={f.key} tone="blue" text={f.message} />)}
                  {flagCount === 0 && (
                    <div style={{ font: '400 12.5px/1.45 var(--gi-sans)', color: 'var(--gi-muted)' }}>No flags yet.</div>
                  )}
                </div>
              </div>
            )}

            {!isAttorney && (
              <>
                <div className="gi-progress-rail">
                  <IntakeSectionProgressList
                    items={progressItems}
                    openId={openId}
                    onSelect={selectSection}
                  />
                </div>
                <button type="button" onClick={() => setReviewOpen(true)} style={guidedPrimaryButtonStyle}>
                  Review questionnaire →
                </button>
                <div style={{ font: '400 11.5px/1.4 var(--gi-sans)', color: 'var(--gi-faint)', textAlign: 'center' }}>
                  {FIRM.firmName} · {FIRM.city} · {FIRM.phone}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {reviewOpen && (
        <ReviewModal
          data={data}
          title={isCollegePrep ? 'Review your College Preparation Plan intake' : 'Review your estate plan organizer'}
          intakeId={intakeId}
          publicIntakeToken={publicIntakeToken}
          isAttorney={isAttorney}
          matterLabel={matterLabel}
          legalFlags={legalFlags}
          readinessFlags={readinessFlags.map((f) => f.message)}
          selectedDocKeys={selectedDocKeys as DesignDocumentKey[]}
          submitting={submitting}
          canSubmit={!isAttorney && !submitted}
          onEdit={(id) => { setReviewOpen(false); if (id) setOpenId(id) }}
          onClose={() => setReviewOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

function SectionIssues({ issues }: { issues: ReturnType<typeof getStepIssues> }) {
  const hasError = issues.some((i) => i.severity === 'error')
  return (
    <div role={hasError ? 'alert' : 'status'} style={{ marginTop: 14, borderRadius: 8, border: '1px solid var(--gi-amber-border)', background: 'var(--gi-amber-bg)', padding: '10px 14px', font: '500 12.5px/1.5 var(--gi-sans)', color: 'var(--gi-amber)' }}>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {issues.map((issue, i) => <li key={`${issue.message}-${i}`}>{issue.message}</li>)}
      </ul>
    </div>
  )
}

export function ReviewModal(props: {
  data: Record<string, unknown>
  /** Heading for the modal — the two intake tracks call their summary different things. */
  title?: string
  intakeId: string
  publicIntakeToken?: string
  isAttorney: boolean
  matterLabel?: string
  selectedDocKeys: DesignDocumentKey[]
  legalFlags: LegalReviewFlag[]
  readinessFlags: string[]
  submitting: boolean
  canSubmit: boolean
  onEdit: (id?: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const {
    data,
    isAttorney,
    selectedDocKeys,
    legalFlags,
    readinessFlags,
    submitting,
    canSubmit,
    onEdit,
    onClose,
    onSubmit,
  } = props

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      {/* `guided-interview` must be repeated here: Radix portals the dialog to
          document.body, outside the shell that declares the --gi-* tokens. Without
          it every var() below resolves to nothing — including this surface, which
          left the whole modal transparent over the page behind it. */}
      <DialogContent
        showCloseButton={false}
        className={`guided-interview ${guidedFontClass} gap-0 overflow-hidden border-0 p-0 shadow-2xl sm:max-w-[920px]`}
        style={{ background: 'var(--gi-surface)' }}
      >
        <div style={{ background: 'var(--gi-navy)', padding: '22px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <DialogTitle style={{ fontWeight: 500, fontSize: 24, color: '#fff', margin: 0 }}>
            {props.title ?? 'Review your estate plan organizer'}
            {props.matterLabel ? ` · ${props.matterLabel}` : ''}
          </DialogTitle>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'rgba(232,237,245,.7)', cursor: 'pointer', padding: '4px 8px', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 28px', maxHeight: 'min(70vh, 720px)', overflowY: 'auto' }}>
          <IntakeQuestionnaireReview
            data={data}
            onEditSection={(id) => onEdit(id)}
            intakeId={props.intakeId}
            publicIntakeToken={props.publicIntakeToken}
          />

          {isAttorney && selectedDocKeys.length > 0 && (
            <div style={{ marginTop: 16, border: '1px solid var(--gi-border)', borderRadius: 11, padding: '17px 19px' }}>
              <div style={{ font: '600 14px/1 var(--gi-sans)', color: 'var(--gi-ink)', marginBottom: 10 }}>Documents to prepare</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {selectedDocKeys.map((k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 13px/1.35 var(--gi-sans)', color: 'var(--gi-strong)' }}>
                    <Check size={13} strokeWidth={2.6} style={{ color: 'var(--gi-teal)', flexShrink: 0 }} />{DESIGN_DOCUMENT_LABELS[k]}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAttorney && (legalFlags.length > 0 || readinessFlags.length > 0) && (
            <div style={{ marginTop: 16, border: '1px solid var(--gi-amber-border)', background: 'var(--gi-amber-bg)', borderRadius: 11, padding: '17px 19px' }}>
              <div style={{ font: '600 14px/1 var(--gi-sans)', color: 'var(--gi-amber)', marginBottom: 12 }}>For your attorney</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, font: '500 12.5px/1.45 var(--gi-sans)', color: 'var(--gi-amber)' }}>
                {legalFlags.map((f) => <div key={f.key}>{f.text}</div>)}
                {readinessFlags.map((t, i) => <div key={`r-${i}`}>{t}</div>)}
              </div>
            </div>
          )}
        </div>

        {(canSubmit || isAttorney) && (
          <div style={{ padding: '18px 28px', borderTop: '1px solid var(--gi-divider)', background: 'var(--gi-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
            {canSubmit && (
              <button type="button" onClick={onSubmit} disabled={submitting} style={{ background: 'var(--gi-teal)', color: '#fff', border: 'none', font: '600 14px/1 var(--gi-sans)', cursor: 'pointer', padding: '13px 24px', borderRadius: 9, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Submit questionnaire →'}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
