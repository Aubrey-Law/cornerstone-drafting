import { describe, expect, it } from 'vitest'
import { COLLEGE_PREP_STEPS } from '@/lib/collegePrepSections'
import { INTAKE_STEPS } from '@/lib/intakeSections'
import { COLLEGE_PREP_INTAKE_FORM, ESTATE_INTAKE_FORM, compileBundledIntakeForm, evaluateBundledIntakeForm, getBundledIntakeForm } from '@/lib/intake/forms/definitions'
import { INTAKE_PARITY_CASES } from '@/tests/fixtures/intakeFormParity'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'

describe('bundled canonical intake definitions', () => {
  it.each([
    ['estate', ESTATE_INTAKE_FORM, INTAKE_STEPS],
    ['college_prep', COLLEGE_PREP_INTAKE_FORM, COLLEGE_PREP_STEPS],
  ] as const)('preserves %s section presentation and shared review', (track, definition, steps) => {
    expect(getBundledIntakeForm(track)).toBe(definition)
    expect(definition.key).toBe(track)
    expect(definition.sections.map(({ id, title, subtitle, timeEstimateMinutes, optional, audience }) => ({
      id, title, subtitle, timeEstimate: timeEstimateMinutes, optional: optional === true, audience,
    }))).toEqual(steps.map(({ id, title, subtitle, timeEstimate, optional }) => ({
      id, title, subtitle, timeEstimate, optional: optional === true, audience: 'client_and_staff',
    })))
    expect(definition.sections.at(-1)?.items).toEqual([{ kind: 'block', id: 'review_submit', blockId: 'review_submit' }])
    for (const audience of ['client', 'staff'] as const) {
      expect(compileBundledIntakeForm(track, audience)).toMatchObject({ success: true, form: { key: track, audience } })
    }
  })

  it('preserves spouse, children and minor-child visibility dependencies', () => {
    expect(ESTATE_INTAKE_FORM.sections.map((section) => section.id)).toEqual(['referral', 'personal', 'family', 'spouse', 'children', 'estate', 'goals', 'additional_contacts', 'fiduciaries', 'spouse_fiduciaries', 'guardian', 'review'])
    expect(COLLEGE_PREP_INTAKE_FORM.sections.map((section) => section.id)).toEqual(['cp_student', 'cp_school', 'cp_parents', 'cp_agents', 'cp_dpoa', 'cp_healthcare', 'cp_hipaa', 'cp_living_will', 'cp_other', 'review'])
    for (const [id, fieldId, value] of [['spouse', 'marital_status', 'married'], ['spouse_fiduciaries', 'marital_status', 'married'], ['children', 'has_children', true], ['guardian', 'has_minor_children', true]]) {
      expect(ESTATE_INTAKE_FORM.sections.find((section) => section.id === id)?.condition).toEqual({ op: 'equals', fieldId, value })
    }
  })

  it('does not duplicate scalar controls owned by compound blocks', () => {
    const fields = ESTATE_INTAKE_FORM.sections.flatMap((section) => section.items.flatMap((item) => item.kind === 'field' ? [item.fieldId] : []))
    for (const id of ['street', 'city', 'state', 'zip', 'asset_types', 'marriage_date', 'has_existing_plan', 'has_divorce_settlement', 'has_ltc_insurance', 'has_prior_gift_tax']) expect(fields).not.toContain(id)
    expect(fields.filter((id) => id === 'county')).toHaveLength(1)
    expect(ESTATE_INTAKE_FORM.sections.find((section) => section.id === 'personal')?.items.find((item) => item.kind === 'block' && item.blockId === 'address')).toMatchObject({ config: { includeCounty: false } })
  })

  it.each(INTAKE_PARITY_CASES)('returns equal shared sections for client/staff: $name', ({ data }) => {
    const track = data.intake_track === 'college_prep' ? 'college_prep' : 'estate'
    expect(evaluateBundledIntakeForm(track, 'staff', data)).toEqual(evaluateBundledIntakeForm(track, 'client', data))
  })

  it('filters approved staff-only content when compiling a bundled form extended for staff', () => {
    const form = { ...ESTATE_INTAKE_FORM, sections: [
      { id: 'internal', title: 'Internal plan choices', audience: 'staff_only', items: [{ kind: 'block', id: 'internal_plan', blockId: 'attorney_plan_structure' }] },
      ...ESTATE_INTAKE_FORM.sections,
    ] }
    const client = compileIntakeForm(form, 'client')
    const staff = compileIntakeForm(form, 'staff')
    expect(client.success).toBe(true)
    expect(staff.success).toBe(true)
    expect(JSON.stringify(client)).not.toContain('internal')
    expect(JSON.stringify(staff)).toContain('internal_plan')
  })

  it('evaluates the explicitly selected track even before the row carries track metadata', () => {
    const data = Object.freeze({})
    expect(evaluateBundledIntakeForm('college_prep', 'client', data).submissionErrors[0].message).toBe("Enter the student's first name.")
    expect(data).toEqual({})
  })

  it('keeps DPOA powers visible before choosing effective timing and hides them only for discuss', () => {
    for (const effective of [undefined, 'immediately', 'discuss']) {
      const data = { intake_track: 'college_prep', college_dpoa_effective: effective }
      const evaluated = evaluateBundledIntakeForm('college_prep', 'client', data).activeSections.find((section) => section.id === 'cp_dpoa')!
      expect(evaluated.items.some((item) => item.id === 'college_dpoa_powers')).toBe(effective !== 'discuss')
      expect(evaluated.issues.some((issue) => issue.message.startsWith('Select the powers'))).toBe(effective === 'immediately')
    }
  })

  it('does not suppress a strengthened required-powers question while timing is unanswered', () => {
    const form = { ...COLLEGE_PREP_INTAKE_FORM, sections: COLLEGE_PREP_INTAKE_FORM.sections.map((section) => ({ ...section, items: section.items.map((item) => item.id === 'college_dpoa_powers' ? { ...item, requirement: 'required' as const } : item) })) }
    const compiled = compileIntakeForm(form, 'client')
    expect(compiled.success).toBe(true)
    if (!compiled.success) return
    expect(evaluateCompiledIntakeForm(compiled.form, { intake_track: 'college_prep' }).issues).toContainEqual(expect.objectContaining({ message: 'Select the powers to grant, or choose “Discuss at the meeting” above.', severity: 'error' }))
  })

  it('uses FERPA, HIPAA, living-will and abroad conditions through nested canonical data without clearing hidden answers', () => {
    const data = Object.freeze({ intake_track: 'college_prep', college_prep_details: Object.freeze({
      ferpa_release: false, ferpa_records: ['grades'], ferpa_recipients: 'Mother', studying_abroad: false, abroad_country: 'France',
      hipaa_scope: 'all', hipaa_excluded_categories: ['mental_health'], hipaa_expiration: 'none', hipaa_expiration_date: '2030-01-01',
      living_will_include: 'no', life_support: 'comfort_only', organ_donation: 'specific', organ_donation_notes: 'Kidneys',
    }) })
    const ids = evaluateBundledIntakeForm('college_prep', 'client', data).activeSections.flatMap((section) => section.items.map((item) => item.id))
    for (const id of ['college_ferpa_records', 'college_ferpa_recipients', 'college_abroad_country', 'college_hipaa_excluded_categories', 'college_hipaa_expiration_date', 'college_life_support', 'college_organ_donation', 'college_organ_donation_notes']) expect(ids).not.toContain(id)
    expect(data.college_prep_details.ferpa_records).toEqual(['grades'])
    expect(data.college_prep_details.organ_donation_notes).toBe('Kidneys')
    const active = evaluateBundledIntakeForm('college_prep', 'client', { ...data, college_prep_details: {
      ...data.college_prep_details, ferpa_release: true, studying_abroad: true, hipaa_scope: 'all_except', hipaa_expiration: 'date', living_will_include: 'yes',
    } }).activeSections.flatMap((section) => section.items.map((item) => item.id))
    for (const id of ['college_ferpa_records', 'college_ferpa_recipients', 'college_abroad_country', 'college_hipaa_excluded_categories', 'college_hipaa_expiration_date', 'college_life_support', 'college_organ_donation', 'college_organ_donation_notes']) expect(active).toContain(id)
  })
})
