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
      name: 'Jane Example Revocable Living Trust',
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

  it('carries the health care agent relationship from the contact record', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-3' }, error: null },
        {
          data: {
            id: 'matter-3',
            client_intake_id: 'intake-3',
            matter_number: 'EP-300',
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
          contact_roles: [{
            id: 'role-hcp',
            contact_id: 'contact-hcp',
            client_intake_id: 'intake-3',
            role: 'hcp',
            for_party: 'client',
            priority: 1,
            is_coagent: false,
          }],
        }],
        error: null,
      }],
    }))

    const payload = await buildDraftPayload('matter-3')

    expect(payload.fiduciaries.hcp_primary).toBe('Harry Proxy')
    expect(payload.fiduciaries.hcp_primary_relationship).toBe('Brother')
  })

  it('derives the spouse from the contacts table (not client_intake.spouse_*)', async () => {
    mocks.getAdminClient.mockReturnValue(adminStub({
      matters: [
        { data: { id: 'matter-2' }, error: null },
        { data: { id: 'matter-2', client_intake_id: 'intake-2', matter_number: 'EP-200', status: 'active', stage: 'drafting' }, error: null },
      ],
      matter_details: [{ data: { id: 'details-2', client_id: 'matter-2', practice_area: 'Estate Planning', ep_trust_type: 'revocable_living' }, error: null }],
      design_sheets: [{ data: { id: 'sheet-2', client_intake_id: 'intake-2', status: 'draft', plan_type: 'trust', is_joint: true }, error: null }],
      client_intake: [{
        data: {
          id: 'intake-2', first_name: 'Alex', last_name: 'Stone', marital_status: 'married',
          // NOTE: no spouse_* keys here on purpose.
        },
        error: null,
      }],
      contacts: [{
        data: [
          { id: 'c-sp', relationship_type: 'spouse', first_name: 'Robin', last_name: 'Stone',
            middle_name: null, preferred_pronoun: 'she/her', date_of_birth: '1979-03-03',
            phone: '+15553334444', email: 'robin@x.com', contact_roles: [] },
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
})
