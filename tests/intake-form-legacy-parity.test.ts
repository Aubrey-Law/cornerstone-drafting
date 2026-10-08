import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileBundledIntakeForm } from '@/lib/intake/forms/definitions'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import { getIntakeTrack } from '@/lib/intakeTrack'
import { getActiveSteps, getRequiredSteps, getStepById, getStepIssues, getSubmissionErrors, type IntakeRow } from '@/lib/intakeSections'

import {
  captureLegacyIntakeResult,
  CONTACT_ONLY,
  COMPLETE_COLLEGE,
  COMPLETE_ESTATE,
  INTAKE_PARITY_CASES,
  type IntakeParityResult,
} from '@/tests/fixtures/intakeFormParity'
import { getStepIssues as getLegacyStepIssues, getStepById as getLegacyStepById } from '@/lib/intake/legacySections'

const EXTENDED_PARITY_CASES = [
  { name: 'estate historical referral option', data: { ...COMPLETE_ESTATE, referral_source: 'Former website source' } },
  { name: 'estate historical legal insurance and suffix options', data: { ...COMPLETE_ESTATE, referral_source: 'Legal Insurance', legal_insurance_plan: 'Former provider', suffix: 'Former suffix' } },
  { name: 'college historical optional CPR option', data: { ...COMPLETE_COLLEGE, college_cpr: 'Former treatment preference' } },
  { name: 'college historical required timing option', data: { ...COMPLETE_COLLEGE, college_dpoa_effective: 'Former timing preference' } },
  { name: 'college historical select preferences', data: { ...COMPLETE_COLLEGE, college_hipaa_scope: 'Former scope', college_hipaa_expiration: 'Former expiration', college_life_support: 'Former support', college_artificial_nutrition: 'Former nutrition', college_ventilation: 'Former ventilation', college_organ_donation: 'Former donation' } },
  { name: 'college historical nested CPR preference', data: { ...COMPLETE_COLLEGE, college_prep_details: { cpr: 'Former treatment preference' } } },
  { name: 'college missing required timing', data: { ...COMPLETE_COLLEGE, college_dpoa_effective: '' } },
  { name: 'estate approved retired value', data: { ...COMPLETE_ESTATE, estate_value: 'under_2m' } },
  { name: 'estate invalid required options', data: { ...COMPLETE_ESTATE, marital_status: 'unknown', estate_value: 'unknown', county: 'unknown' } },
  { name: 'estate adult child without DOB', data: { ...COMPLETE_ESTATE, has_children: true, has_minor_children: false, _children: [{ first_name: 'Adult', last_name: 'Child' }] } },
  { name: 'estate stored review choices', data: { ...CONTACT_ONLY, marital_status: 'married', has_minor_children: true, review_choices: { fiduciaries: 'discuss_with_attorney', spouse_fiduciaries: 'not_provided_yet', guardian: 'discuss_with_attorney' } } },
  { name: 'college blank DPOA powers after selection', data: { ...COMPLETE_COLLEGE, college_dpoa_powers: [], college_organ_donation: '' } },
  { name: 'college FERPA and HIPAA dependencies unanswered', data: { ...COMPLETE_COLLEGE, college_ferpa_records: [], college_hipaa_scope: 'all_except', college_hipaa_expiration: 'date', college_hipaa_expiration_date: '' } },
  { name: 'college discuss choices', data: { ...CONTACT_ONLY, intake_track: 'college_prep', college_dpoa_effective: 'discuss', college_living_will_include: 'discuss', review_choices: { cp_agents: 'discuss_with_attorney' } } },
  { name: 'college nested stored details', data: {
    ...Object.fromEntries(Object.entries(COMPLETE_COLLEGE).filter(([key]) => !key.startsWith('college_'))),
    college_prep_details: Object.fromEntries(Object.entries(COMPLETE_COLLEGE).filter(([key]) => key.startsWith('college_')).map(([key, value]) => [key.slice('college_'.length), value])),
  } },
  { name: 'estate submitted', data: { ...COMPLETE_ESTATE, status: 'submitted' } },
  { name: 'college approved', data: { ...COMPLETE_COLLEGE, status: 'approved', college_hcp_limits: 'Discuss care', college_concerns: 'Moving abroad' } },
]

function captureProductionIntakeResult(data: IntakeRow): IntakeParityResult {
  const active = getActiveSteps(data)
  return {
    activeIds: active.map((step) => step.id),
    requiredIds: getRequiredSteps(data).map((step) => step.id),
    completionById: Object.fromEntries(active.map((step) => [step.id, step.isComplete(data)])),
    issuesById: Object.fromEntries(active.map((step) => [step.id, getStepIssues(step.id, data).map(({ message, severity, blocksSubmission }) => ({ message, severity, blocksSubmission: blocksSubmission === true }))])),
    submissionErrors: getSubmissionErrors(data).map(({ sectionId, message }) => ({ sectionId, message })),
  }
}

function captureCompiledIntakeResult(form: CompiledIntakeForm, data: IntakeRow): IntakeParityResult {
  const result = evaluateCompiledIntakeForm(form, data)
  return {
    activeIds: result.activeSections.map((section) => section.id),
    requiredIds: result.requiredSections.map((section) => section.id),
    completionById: Object.fromEntries(result.activeSections.map((section) => [section.id, section.complete])),
    issuesById: Object.fromEntries(result.activeSections.map((section) => [section.id, section.issues.map(({ message, severity, blocksSubmission }) => ({ message, severity, blocksSubmission: blocksSubmission === true }))])),
    submissionErrors: result.submissionErrors.map(({ sectionId, message }) => ({ sectionId, message })),
  }
}

describe('legacy intake behavior parity matrix', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(INTAKE_PARITY_CASES)('captures the $name intake result', ({ data }) => {
    const result = captureLegacyIntakeResult(data)

    expect(result.activeIds.length).toBeGreaterThan(0)
    expect(result.requiredIds.every((id) => result.activeIds.includes(id))).toBe(true)
    expect(Object.keys(result.completionById)).toEqual(result.activeIds)
    expect(Object.keys(result.issuesById)).toEqual(result.activeIds)
  })

  it.each([...INTAKE_PARITY_CASES, ...EXTENDED_PARITY_CASES])('$name matches the compiled definition and progress', ({ data }) => {
    const compiled = compileBundledIntakeForm(getIntakeTrack(data), 'client')
    expect(compiled.success).toBe(true)
    if (!compiled.success) return
    expect(captureCompiledIntakeResult(compiled.form, data)).toEqual(captureLegacyIntakeResult(data))
    expect(captureProductionIntakeResult(data)).toEqual(captureLegacyIntakeResult(data))
    const required = getRequiredSteps(data)
    const completed = required.filter((step) => step.isComplete(data)).length
    const result = evaluateCompiledIntakeForm(compiled.form, data)
    expect(result.completedRequired).toBe(completed)
    expect(result.percentComplete).toBe(required.length ? Math.round(completed / required.length * 100) : 0)
    expect(result.remainingMinutes).toBe(getActiveSteps(data).filter((step) => !step.isComplete(data)).reduce((minutes, step) => minutes + step.timeEstimate, 0))
  })

  it('re-evaluates compatibility steps with the supplied row after completion changes', () => {
    const step = getActiveSteps(CONTACT_ONLY).find((entry) => entry.id === 'personal')!
    expect(step.isComplete(COMPLETE_ESTATE)).toBe(true)
    expect(step.isComplete(CONTACT_ONLY)).toBe(false)
    const school = getStepById('cp_school')!
    expect(school.isComplete(COMPLETE_COLLEGE)).toBe(true)
    expect(school.isComplete({ intake_track: 'college_prep' })).toBe(false)
  })

  it('preserves direct lookup for hidden sections while active submission skips them', () => {
    const data = { ...CONTACT_ONLY, marital_status: 'single', has_minor_children: false }
    for (const id of ['spouse', 'spouse_fiduciaries', 'guardian']) {
      expect(getStepIssues(id, data)).toEqual(getLegacyStepIssues(id, data))
      expect(getStepById(id)?.isComplete(data)).toBe(getLegacyStepById(id)?.isComplete(data))
      expect(getActiveSteps(data).map(({ id: activeId }) => activeId)).not.toContain(id)
    }
    expect(getSubmissionErrors(data)).toEqual([])
  })

  it('keeps spouse, spouse fiduciary, child, and guardian steps conditional', () => {
    const result = captureLegacyIntakeResult(INTAKE_PARITY_CASES[2].data)

    expect(result.activeIds).toContain('spouse')
    expect(result.activeIds).toContain('spouse_fiduciaries')
    expect(result.activeIds).toContain('children')
    expect(result.activeIds).toContain('guardian')
    const contactOnlyIds = captureLegacyIntakeResult(CONTACT_ONLY).activeIds
    expect(contactOnlyIds).not.toContain('spouse')
    expect(contactOnlyIds).not.toContain('spouse_fiduciaries')
    expect(contactOnlyIds).not.toContain('children')
    expect(contactOnlyIds).not.toContain('guardian')
  })

  it('keeps the estate and college tracks isolated', () => {
    const estate = captureLegacyIntakeResult(INTAKE_PARITY_CASES[0].data)
    const college = captureLegacyIntakeResult(INTAKE_PARITY_CASES[5].data)

    expect(estate.activeIds).toContain('estate')
    expect(estate.activeIds).not.toContain('cp_student')
    expect(college.activeIds).toContain('cp_student')
    expect(college.activeIds).not.toContain('estate')
    expect(college.activeIds).not.toContain('spouse')
    expect(college.activeIds).not.toContain('guardian')
  })

  it('excludes optional sections and review from required steps', () => {
    const estate = captureLegacyIntakeResult(INTAKE_PARITY_CASES[0].data)
    const college = captureLegacyIntakeResult(INTAKE_PARITY_CASES[5].data)

    expect(estate.requiredIds).not.toContain('referral')
    expect(estate.requiredIds).not.toContain('additional_contacts')
    expect(estate.requiredIds).not.toContain('review')
    expect(college.requiredIds).not.toContain('cp_healthcare')
    expect(college.requiredIds).not.toContain('cp_other')
    expect(college.requiredIds).not.toContain('review')
  })

  it('allows contact-only estate intake to submit', () => {
    expect(captureLegacyIntakeResult(CONTACT_ONLY).submissionErrors).toEqual([])
  })

  it('warns without blocking when a college student is under eighteen', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))

    const result = captureLegacyIntakeResult(INTAKE_PARITY_CASES[6].data)
    const warning = result.issuesById.cp_student.find((issue) => issue.message.includes('under 18'))

    expect(warning).toMatchObject({ severity: 'warning', blocksSubmission: false })
    expect(result.submissionErrors).toEqual([])
  })
})
