import { describe, expect, it, vi } from 'vitest'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import {
  defaultDraftPayloadDpoaProvisions,
  defaultDraftPayloadSupplementary,
} from '@/lib/draftPayload/defaults'
import { draftPayloadExcludedGuardians } from '@/lib/draftPayload/excludedGuardians'
import { draftPayloadHealthcare } from '@/lib/draftPayload/healthcare'
import { defaultDraftPayloadTrustProvisions } from '@/lib/draftPayload/trustProvisions'
import type { DraftPayload } from '@/lib/draftPayload/types'
import type { ContactRow } from '@/lib/draftPayload/types'

const mocks = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: mocks.getAdminClient,
}))

type QueryResult = {
  data: unknown
  error: { message: string } | null
}

function adminStub(responses: Record<string, QueryResult[]>) {
  const nextResponse = (table: string): QueryResult => {
    const queue = responses[table]
    return queue?.shift() ?? { data: null, error: null }
  }

  const builder = (table: string) => {
    let consumed = false
    const consume = () => {
      if (consumed) return { data: null, error: null }
      consumed = true
      return nextResponse(table)
    }
    const chain = {
      select: () => chain,
      // loadMatterContacts reads the join, then the contacts by id.
      in: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(consume()),
      then: (onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(consume()).then(onFulfilled, onRejected),
    }
    return chain
  }

  return { from: builder }
}

function basePayload(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    matter: {
      id: 'matter-gaps-1',
      matter_number: 'EP-GAPS-1',
      type: 'individual',
      trust_type: 'revocable_living',
      practice_area: 'Estate Planning',
      minor_children: false,
    },
    client: {
      first_name: 'Jane',
      last_name: 'Example',
      full_name: 'Jane Example',
      aka: null,
      preferred_pronoun: null,
      dob: null,
      address: '123 Main Street',
      city: 'Boston',
      county: 'Suffolk',
      state: 'MA',
      zip: '02108',
      email: null,
      phone: null,
      excluded_guardian: null,
    },
    spouse: null,
    children: [],
    trust: {
      name: 'Jane Example Revocable Living Trust',
      spouse_name: null,
      display_name: 'JANE EXAMPLE REVOCABLE LIVING TRUST',
      spouse_display_name: null,
      date: '2026-01-15',
      distribution_ages: [25],
      ma_estate_taxable: false,
      ma_estate_tax_savings: null,
      separate_trusts: false,
      has_ilit: false,
      ilit_trustee: null,
    },
    trust_provisions: defaultDraftPayloadTrustProvisions(),
    fiduciaries: {
      pr_primary: null,
      pr_co_primary: null,
      pr_successor: null,
      pr_co_successor: null,
      pr_second_successor: null,
      dpoa_primary: 'Alex Agent',
      dpoa_co_agent: null,
      dpoa_successor: null,
      hcp_primary: 'Harper Proxy',
      hcp_primary_address: null,
      hcp_primary_relationship: 'sister',
      hcp_successor: null,
      hcp_successor_address: null,
      hcp_successor_relationship: null,
      trustee_initial: 'Jane Example',
      trustee_co: null,
      trustee_successor: null,
      trustee_co_successor: null,
      trustee_second_successor: null,
      trustee_co_second_successor: null,
      guardian_primary: null,
      guardian_successor: null,
      guardian_second_successor: null,
      temp_guardian_primary: null,
      temp_guardian_co: null,
      temp_guardian_successor: null,
      temp_guardian_second_successor: null,
      spouse_pr_co_primary: null,
      spouse_pr_primary: null,
      spouse_pr_successor: null,
      spouse_dpoa_primary: null,
      spouse_dpoa_successor: null,
      spouse_hcp_primary: null,
      spouse_hcp_primary_address: null,
      spouse_hcp_primary_relationship: null,
      spouse_hcp_successor: null,
      spouse_hcp_successor_address: null,
      spouse_hcp_successor_relationship: null,
      spouse_trustee_successor: null,
      spouse_trustee_co: null,
    },
    documents: {
      include_trust: true,
      include_pour_over_will: false,
      include_simple_will: false,
      include_testamentary_trust_will: false,
      include_dpoa: true,
      include_hcp: true,
      include_hipaa: true,
      include_ahd: true,
      include_ppm: false,
      include_parental_appointment: false,
      include_temp_delegation: false,
      spouse_docs: false,
      trust_planning_type: 'standard',
    },
    execution: {
      signing_month: null,
      signing_year: null,
      signing_county: null,
      notary_commission_expiration: null,
    },
    will_provisions: {
      pr_structure: null,
      trustee_structure: null,
      cotrustee_decision_standard: null,
      bond: 'no_bond',
      supervision: 'unsupervised',
      simultaneous_death: null,
      utma_age: 21,
      no_contest_clause: 'omit',
      include_disclaimer_article: true,
      include_self_proving_affidavit: true,
      tangible_property_distribution: null,
      tangible_property_named_individual: null,
      pour_over_alternate_disposition: null,
      pour_over_alternate_named: null,
      outright_residuary: null,
      outright_residuary_named: null,
      outright_residuary_alternate: null,
      beneficiary_structure: null,
      single_beneficiary_name: null,
      single_beneficiary_remainder: null,
      age_distribution_schedule: null,
      trust_protector: false,
      trust_protector_name: null,
      pet_care_option: 'omit',
      pet_care_details: {},
      specific_bequests: [],
      pr_powers: {
        allow_pay_taxes_debts_expenses: true,
        allow_manage_digital_assets: true,
        include_distribution_cash_or_kind: true,
      },
    },
    design_sheet_id: 'sheet-gaps-1',
    special_provisions: null,
    ancillary_docs: [],
    notes: null,
    ...defaultDraftPayloadSupplementary(),
    dpoa_provisions: defaultDraftPayloadDpoaProvisions(),
    hcp_provisions: {
      anatomical_gift: 'all',
      anatomical_specified: null,
      client_anatomical_gift: 'yes',
      client_advance_directive: 'do_not_prolong_life',
    },
    hipaa_provisions: {
      psychotherapy_notes: 'authorize',
      include_poa: true,
      include_trustees: true,
      list_fiduciaries_by_name: 'by_name',
      client_additional_agents: [{ full_name: 'Extra Agent', phone: '555-0199', email: null, address: null, date_of_birth: null, relationship: 'friend' }],
      spouse_additional_agents: [],
    },
    ...overrides,
  }
}

describe('draft payload generator gap wiring', () => {
  it('maps healthcare, hipaa, assets, excluded guardians, and dpoa provisions into generator data', () => {
    const payload = basePayload({
      excluded_guardians: [
        { full_name: 'Excluded Person', reason: 'estranged' },
        { full_name: 'Second Excluded', reason: null },
      ],
      assets: [{
        category: 'real_property',
        description: '123 Oak Street',
        institution: null,
        estimated_value: 850000,
        notes: null,
        from_intake: true,
      }],
      fiduciary_display: {
        show_phone: true,
        show_address: false,
        show_email: false,
        show_dob: false,
        show_relationship: true,
      },
      fiduciary_details: {
        ...defaultDraftPayloadSupplementary().fiduciary_details!,
        agent: {
          primary: {
            full_name: 'Alex Agent',
            phone: '555-0111',
            email: 'alex@example.com',
            address: '1 Agent Way',
            date_of_birth: '1980-01-01',
            relationship: 'brother',
          },
          co_primary: null,
          successor: null,
        },
      },
      goals_notes: 'Fund trust and sign deed.',
      concerns: 'Blended family.',
    })

    const data = toEstateGeneratorData(payload)

    expect(data.healthcare.client_advance_directive).toBe('do_not_prolong_life')
    expect(data.healthcare.client_anatomical_gift).toBe('yes')
    expect(data.hipaa.include_poa).toBe(true)
    expect(data.hipaa.client_additional_agents).toEqual([{
      full_name: 'Extra Agent',
      relationship: 'friend',
      address: null,
      phone: '555-0199',
      email: null,
      date_of_birth: null,
    }])
    expect(data.dpoa.basic_powers).toBeDefined()
    expect(data.dpoa.allow_gifts).toBeDefined()
    expect(data.dpoa.include_entity_powers).toBe(false)
    expect(data.dpoa.include_advanced_trust_gifting).toBe(false)
    expect(data.dpoa.include_extended_personal_care).toBe(false)
    expect(data.assets.real_property).toBe(true)
    expect(data.assets.items).toHaveLength(1)
    expect(data.guardians.excluded).toEqual([
      { full_name: 'Excluded Person', reason: 'estranged' },
      { full_name: 'Second Excluded', reason: null },
    ])
    const agent = data.fiduciaries.agent as { primary: Record<string, unknown> }
    expect(agent.primary).toMatchObject({
      full_name: 'Alex Agent',
      phone: '555-0111',
      relationship: 'brother',
    })
    expect(data.planning.client_goals).toBe('Fund trust and sign deed.')
    expect(data.planning.client_concerns).toBe('Blended family.')

    const context = buildNodeEstateContext({ data: data as unknown as Record<string, unknown>, state: 'MA' })
    expect(context.owns_real_property).toBe(true)
    expect(context.has_assets).toBe(true)
    expect(context.hcp_client_advance_do_not_prolong).toBe(true)
    expect(context.hipaa_include_poa).toBe(true)
  })

  it('resolves excluded guardians and structured relationships during buildDraftPayload', async () => {
    const contacts: ContactRow[] = [{
      id: 'contact-excluded',
      first_name: 'Taylor',
      middle_name: null,
      last_name: 'Excluded',
      preferred_pronoun: null,
      relationship_type: null,
      relationship_label: null,
      address_line1: null,
      date_of_birth: null,
      phone: null,
      email: null,
      contact_roles: [],
    }, {
      id: 'contact-hcp',
      first_name: 'Harper',
      middle_name: null,
      last_name: 'Proxy',
      preferred_pronoun: null,
      relationship_type: null,
      relationship_label: null,
      address_line1: null,
      date_of_birth: null,
      phone: null,
      email: null,
      contact_roles: [],
    }]

    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-gaps-2' }, error: null },
        {
          data: {
            id: 'matter-gaps-2',
            client_intake_id: 'intake-gaps-2',
            matter_number: 'EP-GAPS-2',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
            matter_type: 'individual',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-gaps-2',
          client_id: 'matter-gaps-2',
          practice_area: 'Estate Planning',
          ep_trust_type: 'revocable_living',
          ep_ancillary_docs: [],
          ep_special_provisions: null,
          ep_ma_estate_taxable: false,
          ep_ma_estate_tax_savings: null,
          ep_separate_trusts: false,
          ep_has_ilit: false,
          ep_ilit_trustee: null,
          internal_notes: null,
        },
        error: null,
      }],
      design_sheets: [{
        data: {
          id: 'sheet-gaps-2',
          client_intake_id: 'intake-gaps-2',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Jane Example',
          marital_status: 'single',
          street: '123 Main Street',
          city: 'Boston',
          county: 'Suffolk',
          state: 'MA',
          zip: '02108',
          trust_name: 'Jane Example Revocable Living Trust',
          trust_date: '2026-01-15',
          excluded_guardian_flag: true,
          goals_notes: 'Update deed',
          concerns: 'Tax exposure',
          assets: [{
            id: 'asset-1',
            category: 'real_property',
            description: 'Vacation home',
            institution: '',
            estimated_value: 500000,
            notes: '',
          }],
          decisions: {
            document_inclusions: {
              trust: true,
              will: true,
              dpoa: true,
              healthcare: true,
              spouse_docs: false,
            },
            excluded_guardians: [{ contact_id: 'contact-excluded', reason: 'not suitable' }],
            healthcare_provisions: {
              client_anatomical_gift: 'no',
              client_advance_directive: 'do_not_resuscitate',
              hipaa_include_poa: true,
              client_hipaa_additional_agent_contact_ids: ['contact-hcp'],
            },
            contact_profiles: {
              'contact-hcp': {
                relationship_kind: 'sibling_sister',
                relationship_to: 'client',
              },
            },
            dpoa_provisions: {
              allow_gifts: true,
              basic_powers: { banking: true },
            },
          },
          hcp_slots: [{ id: 'hcp-1', contact_id: 'contact-hcp', is_co: false, order: 0 }],
        },
        error: null,
      }],
      // Drafting reads contacts through the join since step 3 of
      // docs/matter-contacts-migration.md.
      matter_contacts: [{
        data: contacts.map(c => ({
          matter_id: 'matter-gaps-2',
          contact_id: c.id,
          relationship_type: c.relationship_type ?? null,
          relationship_label: c.relationship_label ?? null,
          child_relationship: null,
          parentage: null,
          is_minor: null,
        })),
        error: null,
      }],
      contacts: [{ data: contacts, error: null }],
    }))

    const payload = await buildDraftPayload('matter-gaps-2')

    expect(payload.excluded_guardians).toEqual([{
      full_name: 'Taylor Excluded',
      reason: 'not suitable',
    }])
    expect(payload.assets).toHaveLength(1)
    expect(payload.hcp_provisions.client_anatomical_gift).toBe('no')
    expect(payload.hcp_provisions.client_advance_directive).toBe('do_not_resuscitate')
    expect(payload.hipaa_provisions.include_poa).toBe(true)
    expect(payload.hipaa_provisions.client_additional_agents?.[0]?.full_name).toBe('Harper Proxy')
    expect(payload.fiduciary_details?.healthcare_agent.primary?.relationship).toBe('sister')
    expect(payload.dpoa_provisions.allow_gifts).toBe(true)
    expect(payload.goals_notes).toBe('Update deed')
  })

  it('carries client and spouse first names into generator data', () => {
    // estate-plan-summary.docx addresses each person by first name; the payload
    // has always split them, but toEstateGeneratorData used to drop them, so
    // every summary silently fell through to `or client.full_name`.
    const data = toEstateGeneratorData(basePayload({
      spouse: {
        first_name: 'Riley',
        last_name: 'Coupleton',
        full_name: 'Riley Coupleton',
        aka: null,
        preferred_pronoun: null,
        citizenship: null,
        dob: null,
      } as DraftPayload['spouse'],
    }))

    expect(data.client.first_name).toBe('Jane')
    expect(data.spouse?.first_name).toBe('Riley')
  })

  it('omits a blank first name so the template falls back to the full name', () => {
    const data = toEstateGeneratorData(basePayload({
      client: { ...basePayload().client, first_name: '', full_name: 'Cher' },
    }))

    expect(data.client).not.toHaveProperty('first_name')
    expect(data.client.full_name).toBe('Cher')
  })

  it('maps legacy excluded guardian name when structured entries are absent', () => {
    const excluded = draftPayloadExcludedGuardians({
      excluded_guardian_flag: true,
      excluded_guardian_name: 'Legacy Excluded',
      decisions: null,
    }, [])

    expect(excluded).toEqual([{ full_name: 'Legacy Excluded', reason: null }])
  })

  it('prefers healthcare provisions over legacy anatomical gift column', () => {
    const bundle = draftPayloadHealthcare({
      id: 'sheet-gaps-healthcare',
      status: null,
      hcp_anatomical_gift: 'all',
      decisions: {
        healthcare_provisions: {
          client_anatomical_gift: 'no',
        },
      },
    }, [])

    expect(bundle.hcp_provisions.anatomical_gift).toBe('none')
    expect(bundle.hcp_provisions.client_anatomical_gift).toBe('no')
  })
})
