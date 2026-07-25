import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const rawLead = {
    id: 'lead-1',
    first_name: 'Jane',
    last_name: 'Doe',
    lead_status: 'lead',
    matter_id: null,
  }
  const hydratedLead = {
    ...rawLead,
    _spouse: { first_name: 'John', last_name: 'Doe', date_of_birth: '1981-01-01' },
    _children: [{ first_name: 'Sam', last_name: 'Doe', date_of_birth: '2014-01-01' }],
    _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
  }
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'client_intake') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rawLead }) }) }) }
      }
      if (table === 'contacts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
      }
      return { select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }
    }),
  }
  return { admin, hydrate: vi.fn(async () => hydratedLead), hydratedLead, rawLead }
})

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => harness.admin }))
vi.mock('@/lib/supabaseServer', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getCachedUserRole: vi.fn(),
}))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: harness.hydrate }))
vi.mock('next/navigation', () => ({ notFound: vi.fn() }))
vi.mock('@/app/admin/leads/[id]/LeadDetailClient', () => ({ LeadDetailClient: () => null }))

import LeadDetailPage from '@/app/admin/leads/[id]/page'

describe('LeadDetailPage intake loader', () => {
  it('hydrates contact-backed household and fiduciary intake data before rendering the lead client', async () => {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })

    expect(harness.hydrate).toHaveBeenCalledWith(harness.admin, harness.rawLead)
    expect((page.props as { lead: unknown }).lead).toBe(harness.hydratedLead)
  })
})
