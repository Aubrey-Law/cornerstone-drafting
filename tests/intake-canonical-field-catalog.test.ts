import { describe, expect, it, vi } from 'vitest'
import * as fields from '@aubrey-law/estate-fields/core'
import { parseIntakeFormDefinition } from '@/lib/intake/forms/schema'

const expectedPaths = {
  client_first_name: 'first_name', client_middle_name: 'middle_name', client_last_name: 'last_name',
  client_suffix: 'suffix', client_prior_name: 'prior_name', client_preferred_name: 'preferred_name',
  client_pronouns: 'preferred_pronoun', client_dob: 'date_of_birth', client_citizenship: 'citizenship_status',
  client_email: 'email', client_phone: 'phone', street: 'street_address', city: 'city', state: 'state',
  zip: 'zip', county: 'county', referral_source: 'referral_source', referral_name: 'referral_name',
  legal_insurance_plan: 'legal_insurance_plan', legal_insurance_member_id: 'legal_insurance_member_id',
  marital_status: 'marital_status', has_children: 'has_children', has_minor_children: 'has_minor_children',
  marriage_date: 'date_of_marriage', estate_value: 'estate_value', asset_types: 'asset_types',
  planning_goals: 'planning_goals', has_existing_plan: 'has_existing_plan',
  has_divorce_settlement: 'has_divorce_settlement', has_ltc_insurance: 'has_ltc_insurance',
  has_prior_gift_tax: 'has_prior_gift_tax', special_notes: 'special_notes',
  college_school_name: 'college_school_name', college_move_in_date: 'college_move_in_date',
  college_school_city: 'college_school_city', college_school_state: 'college_school_state',
  college_studying_abroad: 'college_studying_abroad', college_abroad_country: 'college_abroad_country',
  college_ferpa_release: 'college_ferpa_release', college_ferpa_records: 'college_ferpa_records',
  college_ferpa_recipients: 'college_ferpa_recipients', college_family_circumstances: 'college_family_circumstances',
  college_dpoa_effective: 'college_dpoa_effective', college_dpoa_powers: 'college_dpoa_powers',
  college_dpoa_withheld: 'college_dpoa_withheld', college_dpoa_notes: 'college_dpoa_notes',
  college_hcp_limits: 'college_hcp_limits', college_hcp_instructions: 'college_hcp_instructions',
  college_hipaa_scope: 'college_hipaa_scope', college_hipaa_different_scope: 'college_hipaa_different_scope',
  college_hipaa_excluded_categories: 'college_hipaa_excluded_categories',
  college_hipaa_expiration: 'college_hipaa_expiration', college_hipaa_expiration_date: 'college_hipaa_expiration_date',
  college_living_will_include: 'college_living_will_include', college_life_support: 'college_life_support',
  college_artificial_nutrition: 'college_artificial_nutrition', college_ventilation: 'college_ventilation',
  college_cpr: 'college_cpr', college_comfort_always: 'college_comfort_always',
  college_organ_donation: 'college_organ_donation', college_organ_donation_notes: 'college_organ_donation_notes',
  college_other_medical_notes: 'college_other_medical_notes', college_excluded_people: 'college_excluded_people',
  college_concerns: 'college_concerns',
} as const

describe('canonical builder scalar catalog', () => {
  it('owns the complete scalar inventory and persistence adapters in code', () => {
    expect(fields.BUILDER_FIELD_IDS).toBeDefined()
    expect(new Set(fields.BUILDER_FIELD_IDS)).toEqual(new Set(Object.keys(expectedPaths)))
    for (const id of fields.BUILDER_FIELD_IDS) {
      const def = fields.getBuilderField(id)
      expect(def.id).toBe(id)
      expect(def.builderEnabled).toBe(true)
      expect(def.read).toBeTypeOf('function')
      expect(def.write).toBeTypeOf('function')
      expect(['optional', 'recommended', 'required']).toContain(def.baselineRequirement)
      expect(['text', 'email', 'tel', 'date', 'textarea', 'select', 'boolean', 'multiselect']).toContain(def.control)
      const update = vi.fn()
      const value = id === 'client_citizenship' ? 'US Citizen' : 'fixture'
      fields.writeBuilderFieldValue(id, value, update)
      expect(update.mock.calls[0]?.[0]).toBe(expectedPaths[id as keyof typeof expectedPaths])
    }
    expect(() => fields.getBuilderField('college_hipaa_recipients')).toThrow()
    expect(() => fields.getBuilderField('client_name')).toThrow()
    expect(() => fields.getBuilderField('__proto__')).toThrow()
  })

  it('rejects form-provided storage keys while accepting granular catalog IDs', () => {
    const item = { kind: 'field', id: 'first', fieldId: 'client_first_name' }
    const definition = { schemaVersion: 1, key: 'form', title: 'Form', sections: [
      { id: 'identity', title: 'Identity', audience: 'client_and_staff', items: [item] },
    ] }
    expect(parseIntakeFormDefinition(definition).success).toBe(true)
    expect(parseIntakeFormDefinition({ ...definition, sections: [
      { ...definition.sections[0], items: [{ ...item, intakeKey: 'arbitrary_column' }] },
    ] }).success).toBe(false)
  })

  it('reads stored college details and preserves explicit flat false values', () => {
    expect(fields.readBuilderFieldValue('college_school_name', { college_prep_details: { school_name: 'UMass' } })).toBe('UMass')
    expect(fields.readBuilderFieldValue('college_studying_abroad', {
      college_studying_abroad: false, college_prep_details: { studying_abroad: true },
    })).toBe(false)
    expect(fields.readBuilderFieldValue('planning_goals', { goals: ['avoid_probate'] })).toEqual(['avoid_probate'])
  })

  it('keeps citizenship status and its compatibility boolean synchronized', () => {
    expect(fields.readBuilderFieldValue('client_citizenship', { citizenship_status: 'permanent_resident', is_us_citizen: false })).toBe('Permanent Resident')
    expect(fields.readBuilderFieldValue('client_citizenship', { is_us_citizen: false })).toBe('Non-US — status unconfirmed')
    const update = vi.fn()
    fields.writeBuilderFieldValue('client_citizenship', 'Permanent Resident', update)
    expect(update.mock.calls).toEqual([['citizenship_status', 'permanent_resident'], ['is_us_citizen', false]])
  })

  it('retains existing design mappings and retired estate values', () => {
    expect(fields.getSharedField('client_name').intakeKey).toBe('first_name')
    expect(fields.getSharedField('client_citizenship').intakeKey).toBe('is_us_citizen')
    expect(fields.getSharedField('client_citizenship').intakeToDesign?.(false)).toBe('Non-US — status unconfirmed')
    expect(fields.getBuilderField('estate_value').legacyValues).toContain('under_2m')
    expect(fields.getBuilderField('county').validationProfile).toBe('ma_county')
    expect(fields.getBuilderField('client_email').validationProfile).toBe('email')
    expect(fields.getBuilderField('client_phone').validationProfile).toBe('phone')
    expect(fields.getBuilderField('client_dob').validationProfile).toBe('date')
  })
})
