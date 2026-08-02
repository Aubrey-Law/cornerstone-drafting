import { describe, expect, it, vi } from 'vitest'
import { buildDraftPayload } from '@/lib/buildDraftPayload'

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

describe('buildDraftPayload', () => {
  it('keeps trust metadata for pour-over wills even when the trust document is unchecked', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-1' }, error: null },
        {
          data: {
            id: 'matter-1',
            client_intake_id: 'intake-1',
            matter_number: 'EP-100',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-1',
          client_id: 'matter-1',
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
          id: 'sheet-1',
          client_intake_id: 'intake-1',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Jane Example',
          client_pronouns: 'she/her',
          marital_status: 'single',
          trust_name: null,
          trust_date: null,
          street: '456 Design Street',
          city: 'Newton',
          county: 'Middlesex',
          state: 'MA',
          zip: '02458',
          decisions: {
            document_inclusions: {
              trust: false,
              will: true,
              dpoa: false,
              healthcare: false,
              spouse_docs: false,
            },
          },
          executor_slots: [
            { id: 'executor-primary', contact_id: 'contact-1', is_co: false, order: 0 },
            { id: 'executor-co', contact_id: 'contact-2', is_co: true, order: 0 },
            { id: 'executor-co-2', contact_id: 'contact-3', is_co: true, order: 0 },
          ],
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-1',
          matter_id: 'matter-1',
          first_name: 'Jane',
          middle_name: null,
          last_name: 'Example',
          full_name: 'Jane Example',
          preferred_pronoun: 'she/her',
          date_of_birth: '1970-01-01',
          phone: '5550100',
          email: 'jane@example.com',
          address_line1: null,
          city: null,
          county: null,
          state: null,
          zip: null,
          marital_status: 'single',
          has_minor_children: false,
          spouse_first_name: null,
          spouse_last_name: null,
          spouse_name: null,
          spouse_preferred_pronoun: null,
          spouse_date_of_birth: null,
          spouse_phone: null,
          spouse_email: null,
          practice_area: 'Estate Planning',
        },
        error: null,
      }],
      contacts: [{
        data: [{
          id: 'contact-1',
          first_name: 'Pat',
          last_name: 'Executor',
          relationship_type: 'executor',
          relationship_label: 'Executor',
          address_line1: null,
          date_of_birth: null,
          phone: null,
          email: null,
          contact_roles: [{
            id: 'role-1',
            contact_id: 'contact-1',
            client_intake_id: 'intake-1',
            role: 'executor',
            for_party: 'client',
            priority: 1,
            is_coagent: false,
          }],
        }, {
          id: 'contact-2',
          first_name: 'Casey',
          last_name: 'Coexecutor',
          relationship_type: 'executor',
          relationship_label: 'Co-Executor',
          address_line1: null,
          date_of_birth: null,
          phone: null,
          email: null,
          contact_roles: [],
        }, {
          id: 'contact-3',
          first_name: 'Jordan',
          last_name: 'Coexecutor',
          relationship_type: 'executor',
          relationship_label: 'Co-Executor',
          address_line1: null,
          date_of_birth: null,
          phone: null,
          email: null,
          contact_roles: [],
        }],
        error: null,
      }],
    }))

    const payload = await buildDraftPayload('matter-1')

    expect(payload.documents.include_trust).toBe(false)
    expect(payload.documents.include_pour_over_will).toBe(true)
    expect(payload.trust).toMatchObject({
      name: 'The JE Trust',
      distribution_ages: [25, 30, 35],
    })
    expect(payload.client.preferred_pronoun).toBe('she/her')
    expect(payload.trust?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.client).toMatchObject({
      address: '456 Design Street',
      city: 'Newton',
      county: 'Middlesex',
      state: 'MA',
      zip: '02458',
    })
    expect(payload.fiduciaries).toMatchObject({
      pr_primary: 'Pat Executor',
      pr_co_primary: 'Casey Coexecutor, Jordan Coexecutor',
    })
  })

  it('reads address fields from design-sheet decisions when the columns are empty', async () => {
    // Manual design-sheet edits persist the address into `decisions` rather than
    // the real columns, and intake has no address. The payload must still pick
    // up city/street/state/zip/county so the generator preflight is satisfied.
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-2' }, error: null },
        {
          data: {
            id: 'matter-2',
            client_intake_id: 'intake-2',
            matter_number: 'EP-200',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-2',
          client_id: 'matter-2',
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
          id: 'sheet-2',
          client_intake_id: 'intake-2',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Jane Example',
          marital_status: 'single',
          // Address columns intentionally empty — values live in decisions.
          street: null,
          city: null,
          county: null,
          state: null,
          zip: null,
          decisions: {
            street: '789 Decision Way',
            city: 'Worcester',
            county: 'Worcester',
            state: 'MA',
            zip: '01608',
          },
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-2',
          matter_id: 'matter-2',
          first_name: 'Jane',
          middle_name: null,
          last_name: 'Example',
          full_name: 'Jane Example',
          preferred_pronoun: 'she/her',
          date_of_birth: '1970-01-01',
          phone: '5550100',
          email: 'jane@example.com',
          address_line1: null,
          city: null,
          county: null,
          state: null,
          zip: null,
          marital_status: 'single',
          has_minor_children: false,
          spouse_first_name: null,
          spouse_last_name: null,
          spouse_name: null,
          spouse_preferred_pronoun: null,
          spouse_date_of_birth: null,
          spouse_phone: null,
          spouse_email: null,
          practice_area: 'Estate Planning',
        },
        error: null,
      }],
      contacts: [{ data: [], error: null }],
    }))

    const payload = await buildDraftPayload('matter-2')

    expect(payload.client).toMatchObject({
      address: '789 Decision Way',
      city: 'Worcester',
      county: 'Worcester',
      state: 'MA',
      zip: '01608',
    })
  })

  it('carries the health care agent relationship from design-sheet slots', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-3' }, error: null },
        {
          data: {
            id: 'matter-3',
            client_intake_id: 'intake-3',
            matter_number: 'EP-300',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-3',
          client_id: 'matter-3',
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
          id: 'sheet-3',
          client_intake_id: 'intake-3',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Jane Example',
          marital_status: 'single',
          hcp_slots: [
            { id: 'hcp-primary', contact_id: 'contact-hcp', is_co: false, order: 0 },
          ],
          decisions: {},
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-3',
          matter_id: 'matter-3',
          first_name: 'Jane',
          last_name: 'Example',
          full_name: 'Jane Example',
          marital_status: 'single',
          has_minor_children: false,
          practice_area: 'Estate Planning',
        },
        error: null,
      }],
      contacts: [{
        data: [{
          id: 'contact-hcp',
          first_name: 'Harry',
          last_name: 'Proxy',
          relationship_type: 'sibling',
          relationship_label: 'Brother',
          address_line1: '5 Care Way',
          date_of_birth: null,
          phone: null,
          email: null,
          contact_roles: [],
        }],
        error: null,
      }],
    }))

    const payload = await buildDraftPayload('matter-3')

    expect(payload.fiduciaries.hcp_primary).toBe('Harry Proxy')
    expect(payload.fiduciaries.hcp_primary_relationship).toBe('Brother')
  })

  it('derives the spouse from the design sheet (not contacts)', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-2' }, error: null },
        { data: { id: 'matter-2', client_intake_id: 'intake-2', matter_number: 'EP-200', relationship_status: 'hired', status: 'active', stage: 'drafting' }, error: null },
      ],
      matter_details: [{ data: { id: 'details-2', client_id: 'matter-2', practice_area: 'Estate Planning', ep_trust_type: 'revocable_living' }, error: null }],
      design_sheets: [{
        data: {
          id: 'sheet-2',
          client_intake_id: 'intake-2',
          status: 'draft',
          plan_type: 'trust',
          is_joint: true,
          client_name: 'Alex Stone',
          marital_status: 'married',
          spouse_name: 'Robin Stone',
          spouse_dob: '1979-03-03',
          spouse_pronouns: 'she/her',
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-2', first_name: 'Alex', last_name: 'Stone', marital_status: 'married',
        },
        error: null,
      }],
      contacts: [{
        data: [
          { id: 'c-sp', relationship_type: 'spouse', first_name: 'Wrong', last_name: 'Person',
            middle_name: null, preferred_pronoun: 'they/them', date_of_birth: '1900-01-01',
            phone: null, email: null, contact_roles: [] },
        ],
        error: null,
      }],
    }))

    const payload = await buildDraftPayload('matter-2')
    expect(payload.spouse).not.toBeNull()
    expect(payload.spouse?.full_name).toBe('Robin Stone')
    expect(payload.spouse?.first_name).toBe('Robin')
    expect(payload.spouse?.dob).toBe('1979-03-03')
    expect(payload.spouse?.preferred_pronoun).toBe('she/her')
  })

  it('overlays the computed trust-name default when the sheet leaves it blank', async () => {
    // A joint sheet with a blank trust name should draft with the seeded default
    // ("<Last> Family Trust") rather than the legacy "<Last> Family Revocable
    // Living Trust" fallback — buildDraftPayload overlays computeDesignSheetDefaults.
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-4' }, error: null },
        {
          data: {
            id: 'matter-4',
            client_intake_id: 'intake-4',
            matter_number: 'EP-400',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-4',
          client_id: 'matter-4',
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
          id: 'sheet-4',
          client_intake_id: 'intake-4',
          status: 'draft',
          plan_type: 'joint',
          is_joint: true,
          marital_status: 'married',
          client_name: 'John Smith',
          trust_name: null,
          client_citizenship: null,
          client_domicile: null,
          state: 'MA',
          decisions: {
            document_inclusions: { trust: true, will: true, dpoa: false, healthcare: false, spouse_docs: true },
          },
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-4',
          matter_id: 'matter-4',
          first_name: 'John',
          last_name: 'Smith',
          full_name: 'John Smith',
          marital_status: 'married',
          has_minor_children: false,
          spouse_first_name: 'Mary',
          spouse_last_name: 'Smith',
          spouse_name: 'Mary Smith',
          practice_area: 'Estate Planning',
        },
        error: null,
      }],
      contacts: [{ data: [], error: null }],
    }))

    const payload = await buildDraftPayload('matter-4')

    expect(payload.trust?.name).toBe('Smith Family Trust')
  })

  it('does not read client identity from intake after design sheet is populated', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-5' }, error: null },
        {
          data: {
            id: 'matter-5',
            client_intake_id: 'intake-5',
            matter_number: 'EP-500',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-5',
          client_id: 'matter-5',
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
          id: 'sheet-5',
          client_intake_id: 'intake-5',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Design Sheet Name',
          client_pronouns: 'they/them',
          client_email: 'design@example.com',
          marital_status: 'single',
        },
        error: null,
      }],
      client_intake: [{
        data: {
          id: 'intake-5',
          first_name: 'Intake',
          last_name: 'Only',
          full_name: 'Intake Only',
          preferred_pronoun: 'he/him',
          email: 'intake@example.com',
          marital_status: 'married',
          practice_area: 'Estate Planning',
        },
        error: null,
      }],
      contacts: [{ data: [], error: null }],
    }))

    const payload = await buildDraftPayload('matter-5')

    expect(payload.client.full_name).toBe('Design Sheet Name')
    expect(payload.client.preferred_pronoun).toBe('they/them')
    expect(payload.client.email).toBe('design@example.com')
    expect(payload.matter.type).toBe('individual')
  })

  it('projects trust details decisions into trust_provisions and deed display names', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-trust' }, error: null },
        {
          data: {
            id: 'matter-trust',
            client_intake_id: 'intake-trust',
            matter_number: 'EP-TRUST',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      matter_details: [{
        data: {
          id: 'details-trust',
          client_id: 'matter-trust',
          practice_area: 'Estate Planning',
          ep_trust_type: 'revocable_living',
          ep_ancillary_docs: [],
          ep_special_provisions: null,
          ep_ma_estate_taxable: false,
          ep_ma_estate_tax_savings: null,
          ep_separate_trusts: true,
          ep_has_ilit: false,
          ep_ilit_trustee: null,
          internal_notes: null,
        },
        error: null,
      }],
      design_sheets: [{
        data: {
          id: 'sheet-trust',
          client_intake_id: 'intake-trust',
          status: 'draft',
          plan_type: 'pour_over',
          is_joint: false,
          client_name: 'Jane Smith',
          spouse_name: 'John Smith',
          marital_status: 'married',
          trust_name: 'The Jane Smith Trust',
          spouse_trust_name: 'The John Smith Trust',
          trust_date: '2025-01-15',
          distribution_method: 'outright',
          distribution_age: 30,
          decisions: {
            trust_planning_type: 'disclaimer',
            trust_details: {
              co_trustee_decision: 'independent',
              residual_beneficiary_method: 'outright',
              trust_name_format: {
                client: { date_style: 'ua_dated', append_amendments: true },
                spouse: { date_style: 'dated_only', append_amendments: false },
              },
            },
          },
        },
        error: null,
      }],
      client_intake: [{ data: { id: 'intake-trust', matter_id: 'matter-trust' }, error: null }],
      contacts: [{ data: [], error: null }],
    }))

    const payload = await buildDraftPayload('matter-trust')

    expect(payload.documents.trust_planning_type).toBe('disclaimer')
    expect(payload.trust_provisions.co_trustee_decision).toBe('independent')
    expect(payload.trust_provisions.residual_beneficiary_method).toBe('outright')
    expect(payload.trust?.display_name).toBe(
      'THE JANE SMITH TRUST, U/A dated January 15, 2025, and any amendments thereto',
    )
    expect(payload.trust?.spouse_display_name).toBe('THE JOHN SMITH TRUST dated January 15, 2025')
  })

  it('throws for a missing design sheet in default mode', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-nosheet' }, error: null },
        {
          data: {
            id: 'matter-nosheet',
            client_intake_id: null,
            matter_number: 'EP-200',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      design_sheets: [{ data: null, error: null }],
    }))

    await expect(buildDraftPayload('matter-nosheet')).rejects.toThrow(/No design sheet found/)
  })

  it('allowPartial substitutes a blank sheet instead of throwing', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-nosheet' }, error: null },
        {
          data: {
            id: 'matter-nosheet',
            client_intake_id: null,
            matter_number: 'EP-200',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      design_sheets: [{ data: null, error: null }],
    }))

    const payload = await buildDraftPayload('matter-nosheet', { allowPartial: true })

    expect(payload.design_sheet_id).toBeNull()
    expect(payload.matter.id).toBe('matter-nosheet')
  })

  it('allowPartial tolerates non-hired matters (default mode still throws)', async () => {
    const responses = () => ({
      matters: [
        { data: { id: 'matter-lead' }, error: null },
        {
          data: {
            id: 'matter-lead',
            client_intake_id: null,
            matter_number: 'EP-201',
            relationship_status: 'lead',
            status: 'active',
            stage: 'intake',
          },
          error: null,
        },
      ],
      design_sheets: [{
        data: {
          id: 'sheet-lead',
          status: 'draft',
          client_name: 'Lead Example',
          marital_status: 'single',
          decisions: {},
        },
        error: null,
      }],
    })

    mocks.getAdminClient.mockReturnValue(adminStub(responses()))
    await expect(buildDraftPayload('matter-lead')).rejects.toThrow(/hired matters/)

    mocks.getAdminClient.mockReturnValue(adminStub(responses()))
    const payload = await buildDraftPayload('matter-lead', { allowPartial: true })
    expect(payload.client.full_name).toBe('Lead Example')
    expect(payload.design_sheet_id).toBe('sheet-lead')
  })

  it('passes decisions.extras through as payload.extras', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-extras' }, error: null },
        {
          data: {
            id: 'matter-extras',
            client_intake_id: null,
            matter_number: 'EP-202',
            relationship_status: 'hired',
            status: 'active',
            stage: 'drafting',
          },
          error: null,
        },
      ],
      design_sheets: [{
        data: {
          id: 'sheet-extras',
          status: 'draft',
          client_name: 'Extra Example',
          marital_status: 'single',
          decisions: {
            extras: { firm_motto: 'Plan well.', ignored_object: { nested: true }, count: 3 },
          },
        },
        error: null,
      }],
    }))

    const payload = await buildDraftPayload('matter-extras')

    expect(payload.extras).toEqual({ firm_motto: 'Plan well.', count: '3' })
  })
})
