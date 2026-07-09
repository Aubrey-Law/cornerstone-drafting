import { describe, expect, it } from 'vitest'
import {
  buildFormStateFromDesignSheet,
  collectFiduciaryParties,
  collectTrustNames,
  commitRealEstateTransferToSheet,
  getPersistedRealEstateTransfer,
  hasRealEstateTransferData,
  setPersistedRealEstateTransfer,
} from '@/lib/designSheetRealEstateTransfer'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { buildTemplateFields } from '@/lib/realEstateTransfer/formState'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'

function baseSheet(): DesignSheet {
  return {
    id: 'sheet-1',
    matter_id: 'matter-1',
    version: 1,
    status: 'draft',
    client_name: 'Jane Doe',
    client_dob: null,
    client_phone: null,
    client_email: null,
    client_citizenship: null,
    client_domicile: null,
    street: '1 Main Street',
    city: 'Boston',
    state: 'MA',
    zip: '02108',
    county: 'Suffolk',
    marital_status: 'Married',
    spouse_name: 'John Doe',
    spouse_dob: null,
    spouse_phone: null,
    spouse_email: null,
    spouse_citizenship: null,
    marriage_date: null,
    children: null,
    trustee_primary: null,
    trustee_co: null,
    trustee_alt1: null,
    trustee_alt1_co: null,
    trustee_alt2: null,
    executor_primary: null,
    executor_co: null,
    executor_alt1: null,
    executor_alt1_co: null,
    executor_same_as_trustee: false,
    spouse_executor_same_as_trustee: false,
    poa_primary: null,
    poa_co: null,
    poa_alt1: null,
    poa_same_as_trustee: false,
    spouse_poa_same_as_trustee: false,
    hcp_primary: null,
    hcp_co: null,
    hcp_alt1: null,
    hcp_alt1_co: null,
    guardian_primary: null,
    guardian_co: null,
    guardian_alt1: null,
    guardian_alt1_co: null,
    plan_type: 'revocable_trust',
    is_joint: false,
    trust_name: 'Doe Family Trust',
    spouse_trust_name: null,
    restatement: null,
    trust_protector: null,
    distribution_method: null,
    distribution_age: null,
    include_child_gender_markers: null,
    include_afterborn_children: null,
    include_expectant_children: null,
    omissions_intentional: null,
    include_general_disinheritance: null,
    disinherited_children: null,
    disinherit_issue: null,
    additional_disinheritance_language: null,
    include_additional_beneficiaries: null,
    additional_beneficiaries: null,
    stagger_age_1: null,
    stagger_pct_1: null,
    stagger_age_2: null,
    stagger_pct_2: null,
    stagger_age_3: null,
    tangible_property_distribution: null,
    tangible_property_named_individual: null,
    include_common_disaster: null,
    include_guardians_allowance: null,
    beneficiary_as_cotrustee: null,
    beneficiary_as_sole_trustee: null,
    remote_beneficiary: null,
    provision_lifestyle_disability: null,
    provision_substance_abuse: null,
    provision_married_beneficiary: null,
    decisions: null,
    trustee_slots: [{
      id: 'slot-1',
      contact_id: CLIENT_PRIMARY_CONTACT_ID,
      is_co: false,
      order: 0,
    }],
    executor_slots: [],
    poa_slots: [],
    hcp_slots: [],
    guardian_slots: [],
    temporary_guardian_slots: [],
    spouse_trustee_slots: [],
    spouse_executor_slots: [],
    spouse_poa_slots: [],
    spouse_hcp_slots: [],
    overrides: null,
    goals: null,
    concerns: null,
    assets: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as DesignSheet
}

const matter: PipelineMatter = {
  id: 'matter-1',
  client_name: 'Jane Doe',
  spouse_name: 'John Doe',
} as PipelineMatter

const contacts: MatterContact[] = []

describe('collectTrustNames', () => {
  it('includes client and spouse trust names without duplicates', () => {
    const sheet = baseSheet()
    expect(collectTrustNames(sheet, ['Extra Trust'])).toEqual([
      'Doe Family Trust',
      'Extra Trust',
    ])
  })
})

describe('collectFiduciaryParties', () => {
  it('resolves client shortcut contact from trustee slots', () => {
    const sheet = baseSheet()
    expect(collectFiduciaryParties(sheet, matter, contacts)).toEqual([
      { id: CLIENT_PRIMARY_CONTACT_ID, name: 'Jane Doe' },
    ])
  })
})

describe('buildFormStateFromDesignSheet', () => {
  it('pre-fills client, property, trust, and fiduciary data from the design sheet', () => {
    const sheet = baseSheet()
    const form = buildFormStateFromDesignSheet(sheet, matter, contacts)

    expect(form.clientName).toBe('Jane Doe')
    expect(form.spouseName).toBe('John Doe')
    expect(form.clientPropertyAddress).toBe('1 Main Street')
    expect(form.clientPropertyCity).toBe('Boston')
    expect(form.clientPropertyState).toBe('MA')
    expect(form.clientPropertyCounty).toBe('Suffolk')
    expect(form.trustNames).toEqual(['Doe Family Trust'])
    expect(form.fiduciaries).toEqual([{ id: CLIENT_PRIMARY_CONTACT_ID, name: 'Jane Doe' }])
  })

  it('restores persisted transfer configuration from decisions JSONB', () => {
    const sheet = {
      ...baseSheet(),
      decisions: setPersistedRealEstateTransfer(baseSheet(), {
        realtyTrustName: '1 Main Street Realty Trust',
        realtyTrustDate: '2020-01-15',
        grantees: [{ id: 'g1', source: 'realty_trust' }],
        deedFields: { grantor: 'Prior Owner' },
      }),
    }

    const form = buildFormStateFromDesignSheet(sheet, matter, contacts)
    expect(form.realtyTrustName).toBe('1 Main Street Realty Trust')
    expect(form.realtyTrustDate).toBe('2020-01-15')
    expect(form.grantees).toHaveLength(1)
    expect(form.deedFields.grantor).toBe('Prior Owner')
  })
})

describe('commitRealEstateTransferToSheet', () => {
  it('persists transfer state and enables deed document inclusion', () => {
    const sheet = baseSheet()
    const form = buildFormStateFromDesignSheet(sheet, matter, contacts)
    form.realtyTrustName = 'Doe Realty Trust'
    form.grantees = [{ id: 'g1', source: 'realty_trust' }]

    const decisions = commitRealEstateTransferToSheet(sheet, form)
    const persisted = getPersistedRealEstateTransfer({ decisions })
    const inclusions = getDocumentInclusions({ ...sheet, decisions })

    expect(persisted.realtyTrustName).toBe('Doe Realty Trust')
    expect(inclusions.deed).toBe(true)
    expect(hasRealEstateTransferData(form)).toBe(true)
    expect(buildTemplateFields(form).trust_name).toBe('Doe Realty Trust')
  })
})
