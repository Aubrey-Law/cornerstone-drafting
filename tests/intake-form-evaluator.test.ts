import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const FORM: IntakeFormDefinition = { schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
  { id: 'personal', title: 'Contact', timeEstimateMinutes: 5, audience: 'client_and_staff', items: [
    { kind: 'field', id: 'first', fieldId: 'client_first_name' },
    { kind: 'field', id: 'last', fieldId: 'client_last_name' },
    { kind: 'field', id: 'email', fieldId: 'client_email' },
    { kind: 'field', id: 'phone', fieldId: 'client_phone' },
    { kind: 'block', id: 'address', blockId: 'address' },
    { kind: 'field', id: 'dob', fieldId: 'client_dob' },
  ] },
  { id: 'family', title: 'Family', timeEstimateMinutes: 2, audience: 'client_and_staff', items: [{ kind: 'field', id: 'marital', fieldId: 'marital_status', requirement: 'required' }] },
  { id: 'spouse', title: 'Spouse', timeEstimateMinutes: 3, audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' }, items: [{ kind: 'block', id: 'spouse_block', blockId: 'spouse_details' }] },
  { id: 'estate', title: 'Assets', timeEstimateMinutes: 4, audience: 'client_and_staff', items: [{ kind: 'field', id: 'value', fieldId: 'estate_value', requirement: 'required' }, { kind: 'block', id: 'assets', blockId: 'financial_assets' }] },
  { id: 'optional', title: 'Optional', optional: true, timeEstimateMinutes: 1, audience: 'client_and_staff', items: [{ kind: 'field', id: 'notes', fieldId: 'special_notes' }] },
  { id: 'internal', title: 'Internal', audience: 'staff_only', items: [{ kind: 'block', id: 'plan', blockId: 'attorney_plan_structure' }] },
  { id: 'review', title: 'Review', timeEstimateMinutes: 2, audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
function compiled(raw = FORM) {
  const result = compileIntakeForm(raw, 'client')
  if (!result.success) throw new Error(JSON.stringify(result.errors))
  return result.form
}

describe('compiled intake evaluation', () => {
  afterEach(() => vi.useRealTimers())
  it('derives required progress, issues, and contact-only submission errors once', () => {
    const evaluated = evaluateCompiledIntakeForm(compiled(), { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '6175551234', marital_status: 'single' })
    expect(evaluated.activeSections.map((s) => s.id)).toEqual(['personal', 'family', 'estate', 'optional', 'review'])
    expect(evaluated.requiredSections.map((s) => s.id)).toEqual(['personal', 'family', 'estate'])
    expect(evaluated.completedRequired).toBe(1)
    expect(evaluated.percentComplete).toBe(33)
    expect(evaluated.remainingMinutes).toBe(12)
    expect(evaluated.issues.some((i) => i.sectionId === 'estate')).toBe(true)
    expect(evaluated.submissionErrors).toEqual([])
  })

  it('reports invalid contact values as blocking errors', () => {
    const evaluated = evaluateCompiledIntakeForm(compiled(), { first_name: 'Jane', last_name: 'Doe', email: 'invalid', phone: '6175551234' })
    expect(evaluated.submissionErrors).toEqual([expect.objectContaining({ sectionId: 'personal', severity: 'error', blocksSubmission: true })])
  })

  it('skips a populated hidden spouse without changing stored answers', () => {
    const data = { marital_status: 'married', _spouse: { first_name: 'John' } }
    const before = structuredClone(data)
    expect(evaluateCompiledIntakeForm(compiled(), data).issues.some((i) => i.sectionId === 'spouse')).toBe(true)
    const single = { ...data, marital_status: 'single' }
    const evaluated = evaluateCompiledIntakeForm(compiled(), single)
    expect(evaluated.activeSections.some((s) => s.id === 'spouse')).toBe(false)
    expect(evaluated.issues.some((i) => i.sectionId === 'spouse')).toBe(false)
    expect(data).toEqual(before)
    expect(single._spouse).toEqual(before._spouse)
  })

  it('evaluates conditions through canonical adapters and skips hidden fields and blocks', () => {
    const raw: IntakeFormDefinition = { schemaVersion: 1, key: 'college', title: 'College', sections: [
      { id: 'school', title: 'School', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'release', fieldId: 'college_ferpa_release', requirement: 'required' },
        { kind: 'field', id: 'records', fieldId: 'college_ferpa_records', requirement: 'required', condition: { op: 'equals', fieldId: 'college_ferpa_release', value: true } },
        { kind: 'block', id: 'people', blockId: 'college_parents', condition: { op: 'equals', fieldId: 'college_ferpa_release', value: true } },
      ] }, FORM.sections[6],
    ] }
    const data = { college_prep_details: { ferpa_release: false, ferpa_records: ['grades'] } }
    const result = evaluateCompiledIntakeForm(compiled(raw), data)
    expect(result.activeSections[0].items.map((i) => i.id)).toEqual(['release'])
    expect(result.activeSections[0].complete).toBe(true)
    expect(result.issues).toEqual([])
    expect(data.college_prep_details.ferpa_records).toEqual(['grades'])
  })

  it('accepts retired estate values and does not count optional unanswered items against progress', () => {
    const result = evaluateCompiledIntakeForm(compiled(), { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '6175551234', street_address: '1 Main', city: 'Boston', state: 'MA', zip: '02110', county: 'Suffolk', date_of_birth: '1990-01-01', marital_status: 'single', estate_value: 'under_2m', asset_types: ['real_estate'] })
    expect(result.issues).toEqual([])
    expect(result.completedRequired).toBe(3)
    expect(result.percentComplete).toBe(100)
    expect(result.activeSections.find((s) => s.id === 'optional')?.complete).toBe(false)
    expect(result.activeSections.some((s) => s.id === 'internal')).toBe(false)
  })

  it('retains the empty required-section progress baseline', () => {
    expect(evaluateCompiledIntakeForm(compiled({ ...FORM, sections: [FORM.sections[6]] }), {}).percentComplete).toBe(0)
  })

  it('surfaces strengthened noncontact requirements without blocking submission', () => {
    const raw: IntakeFormDefinition = { ...FORM, sections: [
      { id: 'custom', title: 'Custom', audience: 'client_and_staff', items: [{ kind: 'field', id: 'notes', fieldId: 'special_notes', requirement: 'required' }] }, FORM.sections[6],
    ] }
    const result = evaluateCompiledIntakeForm(compiled(raw), {})
    expect(result.activeSections[0].complete).toBe(false)
    expect(result.issues).toEqual([expect.objectContaining({ sectionId: 'custom', severity: 'error' })])
    expect(result.submissionErrors).toEqual([])
  })

  it('retains the college under-eighteen warning without blocking a valid contact', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    const result = evaluateCompiledIntakeForm(compiled(), { intake_track: 'college_prep', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '6175551234', date_of_birth: '2010-01-01' })
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringContaining('under 18') }))
    expect(result.submissionErrors).toEqual([])
  })

  it('evaluates the code-owned campus city/state warning as one question', () => {
    const raw: IntakeFormDefinition = { ...FORM, sections: [
      { id: 'school', title: 'School', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'city', fieldId: 'college_school_city', requirement: 'recommended' },
        { kind: 'field', id: 'state', fieldId: 'college_school_state' },
      ] }, FORM.sections[6],
    ] }
    const result = evaluateCompiledIntakeForm(compiled(raw), { college_prep_details: { school_city: 'Boston' } })
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'warning', message: 'Enter the campus city and state — an out-of-state campus changes which forms providers there will accept.' })])
    expect(result.activeSections[0].complete).toBe(true)
  })

  it('accepts the builder-only retired citizenship value', () => {
    const raw: IntakeFormDefinition = { ...FORM, sections: [
      { id: 'citizenship', title: 'Citizenship', audience: 'client_and_staff', items: [{ kind: 'field', id: 'citizen', fieldId: 'client_citizenship', requirement: 'required' }] }, FORM.sections[6],
    ] }
    expect(evaluateCompiledIntakeForm(compiled(raw), { citizenship_status: 'other' }).issues).toEqual([])
  })

  it('rejects non-string contact names instead of treating arbitrary values as answers', () => {
    const result = evaluateCompiledIntakeForm(compiled(), { first_name: 123, last_name: {}, email: 'jane@example.com', phone: '6175551234' })
    expect(result.submissionErrors.map((issue) => issue.message)).toEqual(['Enter your first name.', 'Enter your last name.'])
  })

  it('counts a section containing ordinary questions and the review block as required', () => {
    const raw: IntakeFormDefinition = { ...FORM, sections: [{ ...FORM.sections[0], items: [FORM.sections[0].items[0], FORM.sections[6].items[0]] }] }
    const result = evaluateCompiledIntakeForm(compiled(raw), {})
    expect(result.requiredSections.map((section) => section.id)).toEqual(['personal'])
    expect(result.completedRequired).toBe(0)
  })
})
