'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Loader2, ChevronRight, ChevronLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { useAutoSave, type SaveStatus } from '@/hooks/useAutoSave'
import { useContacts } from '@/hooks/useContacts'
import {
  formatSubmissionIssueList,
  getActiveSteps,
  getStepById,
  getStepIssues,
  getSubmissionErrors,
  getSubmissionIssues,
  type IntakeSectionIssue,
  type IntakeRow,
} from '@/lib/intakeSections'
import { formatPhoneInput } from '@/lib/phone'
import { isFinancialDetailsRootKey } from '@/lib/intakeFinancialFields'
import { unpackReferralDetailsFromFamilyDetails } from '@/lib/intakeReferralDetails'
import type { ChildEntry, FiduciaryEntry, AdditionalContactEntry } from './IntakeWizard'

const NAVY = '#1f2d5a'
const TEAL = '#1b6b72'

type StepProps = {
  data: Record<string, unknown>
  update: (field: string, value: unknown) => void
  intakeId?: string
}

const stepLoading = () => (
  <div className="space-y-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="space-y-2">
        <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-10 animate-pulse rounded-md bg-gray-100" />
      </div>
    ))}
  </div>
)

const StepReferral = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepReferral), { loading: stepLoading })
const StepPersonal = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepPersonal), { loading: stepLoading })
const StepFamily = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepFamily), { loading: stepLoading })
const StepSpouse = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepSpouse), { loading: stepLoading })
const StepChildren = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepChildren), { loading: stepLoading })
const StepEstate = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepEstate), { loading: stepLoading })
const StepGoals = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepGoals), { loading: stepLoading })
const StepAdditionalContacts = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepAdditionalContacts), { loading: stepLoading })
const StepFiduciaries = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepFiduciaries), { loading: stepLoading })
const StepSpouseFiduciaries = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepSpouseFiduciaries), { loading: stepLoading })
const StepGuardian = dynamic<StepProps>(() => import('./IntakeWizard').then(mod => mod.StepGuardian), { loading: stepLoading })
const StepReview = dynamic<{ data: Record<string, unknown> }>(() => import('./IntakeWizard').then(mod => mod.StepReview), { loading: stepLoading })

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      {status === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>}
      {status === 'saved' && <><Save className="h-3.5 w-3.5 text-green-500" /> Saved</>}
      {status === 'dirty' && <><span className="h-2 w-2 rounded-full bg-amber-500" /> Unsaved changes</>}
      {status === 'error' && <><span className="h-2 w-2 rounded-full bg-red-500" /> Save error</>}
    </div>
  )
}

interface Props {
  initialData: Record<string, unknown>
  intakeId: string
  sectionId: string
  publicIntakeToken?: string
}

export function unpackInitialData(initialData: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { ...initialData }

  const fd = base.financial_details as Record<string, unknown> | undefined
  if (fd && typeof fd === 'object') {
    for (const [k, v] of Object.entries(fd)) {
      if (isFinancialDetailsRootKey(k)) {
        base[k] = v
      } else {
        base[`financial_${k}`] = v
      }
    }
    delete base.financial_details
    const legacyAssets = base.financial_asset_types as unknown
    if (!base.asset_types && Array.isArray(legacyAssets)) {
      base.asset_types = legacyAssets
    }
  }

  // F4a: review_choices is now a top-level column, not nested in
  // fiduciary_entries. Hydrate the overlay from there first; the JSONB
  // fallback below still handles legacy rows during transition.
  if (base.review_choices && typeof base.review_choices === 'object') {
    base._review_choices = base.review_choices
  }

  const fe = base.fiduciary_entries as Record<string, unknown> | undefined
  if (fe && typeof fe === 'object') {
    for (const [k, v] of Object.entries(fe)) {
      if (k === 'children') {
        base._children = v
      } else if (k === 'additional_contacts') {
        base._additional_contacts = v
      } else if (k === 'review_choices') {
        // Only hydrate from JSONB if the top-level column was empty
        // (handles legacy rows; new rows use the column).
        if (!base._review_choices) base._review_choices = v
      } else {
        base[`_${k}`] = v
      }
    }
    delete base.fiduciary_entries
  }

  if (!base._spouse && (base.spouse_first_name || base.spouse_last_name)) {
    base._spouse = {
      first_name: base.spouse_first_name ?? '',
      last_name: base.spouse_last_name ?? '',
      middle_name: base.spouse_middle_name ?? '',
      suffix: base.spouse_suffix ?? '',
      prior_names: base.spouse_prior_names ?? '',
      preferred_name: base.spouse_preferred_name ?? '',
      preferred_pronoun: base.spouse_preferred_pronoun ?? '',
      date_of_birth: base.spouse_date_of_birth ?? '',
      is_us_citizen: base.spouse_is_us_citizen ?? true,
      phone: formatPhoneInput(typeof base.spouse_phone === 'string' ? base.spouse_phone : ''),
      email: base.spouse_email ?? '',
    }
  }

  // Legacy UI/API field names saved under older keys
  if (base.planning_goals == null && base.goals != null) {
    base.planning_goals = base.goals
  }
  if (base.special_notes == null && base.additional_notes != null) {
    base.special_notes = base.additional_notes
  }
  if (base.excluded_guardian == null && base.excluded_guardians != null) {
    base.excluded_guardian = base.excluded_guardians
  }
  if (base.preferred_pronoun == null && base.pronouns != null) {
    base.preferred_pronoun = base.pronouns
  }

  // Wizard reads `street_address`; persisted column is `address_line1`.
  const sa = typeof base.street_address === 'string' ? base.street_address.trim() : ''
  const a1 = typeof base.address_line1 === 'string' ? base.address_line1.trim() : ''
  if (!sa && a1) base.street_address = a1

  return unpackReferralDetailsFromFamilyDetails(base)
}

function toastSubmissionIssues(issues: IntakeSectionIssue[]) {
  const description = formatSubmissionIssueList(issues)
  toast.error('Please complete these required items before submitting.', {
    description: description || undefined,
  })
}

export default function IntakeStepPage({
  initialData,
  intakeId,
  sectionId,
  publicIntakeToken,
}: Props) {
  const router = useRouter()
  const [data, setData] = useState<Record<string, unknown>>(() => unpackInitialData(initialData))
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  const [submitting, setSubmitting] = useState(false)
  const [showValidation, setShowValidation] = useState(sectionId === 'review')

  const { status: saveStatus, debouncedSave, saveNow, flush, trackForFlush } = useAutoSave(
    intakeId, 1500, publicIntakeToken,
  )
  const { saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts } = useContacts(intakeId)

  const activeSteps = useMemo(() => getActiveSteps(data as IntakeRow), [data])
  const currentStep = getStepById(sectionId)
  const currentIndex = activeSteps.findIndex((s) => s.id === sectionId)
  const isLast = currentIndex === activeSteps.length - 1
  const isFirst = currentIndex <= 0
  const visibleIssues = useMemo(() => {
    const issues = sectionId === 'review'
      ? getSubmissionIssues(data as IntakeRow)
      : getStepIssues(sectionId, data as IntakeRow)
    return sectionId === 'review' || showValidation ? issues : []
  }, [data, sectionId, showValidation])

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

  const persistContactsForStep = useCallback(
    async (stepId: string, current: Record<string, unknown>) => {
      if (stepId === 'spouse' && current._spouse) {
        await saveSpouse(current._spouse as Record<string, string>)
      }
      if (stepId === 'children' && current._children) {
        await saveChildren(current._children as ChildEntry[])
      }
      if (stepId === 'additional_contacts') {
        await saveAdditionalContacts(((current._additional_contacts as AdditionalContactEntry[]) ?? []))
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
      }
      const roles = fiduciarySteps[stepId]
      if (roles) {
        for (const [role, party] of roles) {
          const key = `_fid_${role}_${party}`
          const entries = current[key] as FiduciaryEntry[] | undefined
          const namedEntries = entries?.filter(
            (entry) => entry.first_name?.trim() || entry.last_name?.trim(),
          )
          if (namedEntries && namedEntries.length > 0) {
            await saveFiduciaries(namedEntries, role, party)
          }
        }
      }
    },
    [saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts],
  )

  const navigateTo = useCallback(
    async (targetSectionId: string) => {
      const current = dataRef.current
      const stepNum = activeSteps.findIndex((s) => s.id === targetSectionId) + 1
      const [saved] = await Promise.all([
        saveNow({ ...current, current_step: Math.max(stepNum, 1) }),
        persistContactsForStep(sectionId, current),
      ])
      if (!saved) {
        toast.error('We could not save this section. Please try again before continuing.')
        return false
      }
      router.push(`/intake/${targetSectionId}`)
      return true
    },
    [saveNow, persistContactsForStep, sectionId, activeSteps, router],
  )

  async function handleNext() {
    if (currentIndex < 0 || currentIndex >= activeSteps.length - 1) return
    const errors = getStepIssues(sectionId, dataRef.current as IntakeRow).filter(
      (issue) => issue.severity === 'error',
    )
    if (errors.length > 0) {
      setShowValidation(true)
      toast.error('Please finish the required items before continuing.')
      return
    }
    await navigateTo(activeSteps[currentIndex + 1].id)
  }

  async function handlePrevious() {
    if (currentIndex <= 0) return
    await navigateTo(activeSteps[currentIndex - 1].id)
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const submitErrors = getSubmissionErrors(dataRef.current as IntakeRow)
      if (submitErrors.length > 0) {
        setShowValidation(true)
        toastSubmissionIssues(submitErrors)
        setSubmitting(false)
        return
      }

      const flushed = await flush()
      if (!flushed) {
        toast.error('We could not save your latest changes. Please try again before submitting.')
        setSubmitting(false)
        return
      }
      await persistContactsForStep(sectionId, dataRef.current)

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
        if (res.status === 422) {
          setShowValidation(true)
          const serverIssues = Array.isArray(body.issues)
            ? body.issues as IntakeSectionIssue[]
            : getSubmissionErrors(dataRef.current as IntakeRow)
          toastSubmissionIssues(serverIssues)
        } else {
          toast.error(body.error ?? 'Failed to submit questionnaire. Please try again.')
        }
        setSubmitting(false)
        return
      }

      router.push('/intake')
      router.refresh()
    } catch {
      toast.error('An unexpected error occurred.')
      setSubmitting(false)
    }
  }

  if (!currentStep) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-muted-foreground">Section not found.</p>
        <Link href="/intake" className="mt-4 inline-block text-sm underline">
          Back to overview
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-10">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/intake"
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Overview
          </Link>
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-gray-400">
            Step {currentIndex + 1} of {activeSteps.length}
          </p>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>
            {currentStep.title}
          </h1>
          {currentStep.subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{currentStep.subtitle}</p>
          )}
        </div>
        <div className="mt-1 shrink-0">
          <SaveStatusBadge status={saveStatus} />
        </div>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        {saveStatus === 'error' && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <p>
                We could not save your latest changes. Please check your connection and try again before leaving this page.
              </p>
            </div>
          </div>
        )}

        {visibleIssues.length > 0 && (
          <div
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            role={visibleIssues.some((issue) => issue.severity === 'error') ? 'alert' : 'status'}
          >
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-semibold">
                  {visibleIssues.some((issue) => issue.severity === 'error')
                    ? sectionId === 'review'
                      ? 'Finish these before submitting'
                      : 'Finish these before continuing'
                    : 'Helpful items to add if you can'}
                </p>
                <ul className="mt-2 space-y-1">
                  {visibleIssues.map((issue, index) => (
                    <li key={`${issue.sectionId}-${issue.message}-${index}`}>
                      {sectionId === 'review' && (
                        <Link href={`/intake/${issue.sectionId}`} className="font-medium underline">
                          {issue.sectionTitle}:
                        </Link>
                      )}{' '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {sectionId === 'referral' && <StepReferral data={data} update={update} />}
        {sectionId === 'personal' && <StepPersonal data={data} update={update} />}
        {sectionId === 'family' && <StepFamily data={data} update={update} />}
        {sectionId === 'spouse' && <StepSpouse data={data} update={update} />}
        {sectionId === 'children' && <StepChildren data={data} update={update} />}
        {sectionId === 'estate' && <StepEstate data={data} update={update} />}
        {sectionId === 'goals' && <StepGoals data={data} update={update} />}
        {sectionId === 'additional_contacts' && <StepAdditionalContacts data={data} update={update} />}
        {sectionId === 'fiduciaries' && <StepFiduciaries data={data} update={update} intakeId={intakeId} />}
        {sectionId === 'spouse_fiduciaries' && <StepSpouseFiduciaries data={data} update={update} intakeId={intakeId} />}
        {sectionId === 'guardian' && <StepGuardian data={data} update={update} intakeId={intakeId} />}
        {sectionId === 'review' && <StepReview data={data} />}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-6">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={isFirst}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>

          {sectionId === 'review' ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
              ) : (
                'Submit Questionnaire'
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={isLast}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: TEAL }}
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
