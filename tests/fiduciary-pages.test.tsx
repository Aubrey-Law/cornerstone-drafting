// @vitest-environment jsdom

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { GeneratedDatabase } from '@/types/supabase'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const auth = vi.hoisted(() => ({
  claims: { id: 'staff-1' } as { id: string } | null,
  role: 'attorney' as string | null,
  apiUser: 'staff-1' as string | null,
  client: null as unknown,
}))
vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => auth.claims),
  getCachedUserRole: vi.fn(async () => auth.role),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => auth.client) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    auth.apiUser
      ? { err: null, userId: auth.apiUser }
      : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null },
  ),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
}))

import { loadFiduciaryOverview, loadMatterFiduciaryView } from '@/lib/fiduciary/view'
import { GET } from '@/app/api/admin/matters/[id]/fiduciaries/route'
import FiduciariesPage from '@/app/admin/fiduciaries/page'
import { MatterFiduciaryCard } from '@/app/admin/matters/[id]/MatterFiduciaryCard'
import { EMPTY_PLAN_MIRROR } from '@/lib/matter/planMirror'

const SMITH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const JONES = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

const role = (contact: string, roleName: string, priority: number, matter: string, extra: Record<string, unknown> = {}) => ({
  contact_id: contact,
  role: roleName,
  for_party: 'client',
  priority,
  is_coagent: false,
  matter_id: matter,
  client_intake_id: null,
  ...extra,
})

function seed() {
  return makeFakeClient({
    matters: [
      { id: SMITH, name: 'Smith Estate Plan', client_intake_id: 'i-smith', relationship_status: 'hired' },
      { id: JONES, name: 'Jones Estate Plan', client_intake_id: 'i-jones', relationship_status: 'hired' },
      { id: LEAD, name: 'Lee (lead)', client_intake_id: 'i-lee', relationship_status: 'lead' },
    ],
    contacts: [
      { id: 'c-anne', first_name: 'Anne', middle_name: null, last_name: 'Smith' },
      { id: 'c-bob', first_name: 'Bob', middle_name: null, last_name: 'Smith' },
      { id: 'c-cara', first_name: 'Cara', middle_name: null, last_name: 'Jones' },
    ],
    contact_roles: [
      // Smith: a trustee with a successor, and a personal representative with none.
      role('c-anne', 'trustee', 1, SMITH),
      role('c-bob', 'trustee', 2, SMITH),
      role('c-anne', 'personal_rep', 1, SMITH),
      // Jones: a trustee and successor, nothing missing.
      role('c-cara', 'trustee', 1, JONES),
      role('c-anne', 'trustee', 2, JONES),
      // A lead: shown on its own page, never in the firm-wide list.
      role('c-cara', 'trustee', 1, LEAD),
    ],
    // Smith has a minor child and no guardian named.
    matter_contacts: [{ matter_id: SMITH, is_minor: true }],
  })
}

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.apiUser = 'staff-1'
  auth.client = asClient(seed())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the fiduciary view', () => {
  it('names each gap on a matter, the offices each person holds, and each chain in order of service', async () => {
    const view = await loadMatterFiduciaryView(asClient(seed()), SMITH)
    expect(view?.issues.map(issue => [issue.kind, issue.severity])).toEqual([
      ['no_successor', 'gap'],
      ['no_guardian', 'gap'],
    ])
    expect(view?.people).toEqual([
      { name: 'Anne Smith', offices: ['Trustee', 'Personal representative'] },
      { name: 'Bob Smith', offices: ['Trustee'] },
    ])
    expect(view?.chains[0]).toEqual({
      roleKey: 'trustee',
      role: 'Trustee',
      forParty: 'client',
      people: [
        { name: 'Anne Smith', isCoagent: false },
        { name: 'Bob Smith', isCoagent: false },
      ],
    })
  })

  it('shows one matter whatever its status, and null for one that does not exist', async () => {
    expect((await loadMatterFiduciaryView(asClient(seed()), LEAD))?.title).toBe('Lee (lead)')
    expect(await loadMatterFiduciaryView(asClient(seed()), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBeNull()
  })

  it('lists hired matters only, gaps first', async () => {
    expect(await loadFiduciaryOverview(asClient(seed()))).toEqual([
      { matterId: SMITH, title: 'Smith Estate Plan', gaps: 2, notes: 0 },
      { matterId: JONES, title: 'Jones Estate Plan', gaps: 0, notes: 0 },
    ])
  })
})

describe('GET /api/admin/matters/[id]/fiduciaries', () => {
  const call = (id: string) => GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })

  it('serves a matter’s matrix to staff', async () => {
    const response = await call(SMITH)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { fiduciaries: { title: string } }
    expect(body.fiduciaries.title).toBe('Smith Estate Plan')
  })

  it('refuses a bad id, a missing matter, and a caller who is not staff', async () => {
    expect((await call('nope')).status).toBe(400)
    expect((await call('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).status).toBe(404)
    auth.apiUser = null
    expect((await call(SMITH)).status).toBe(403)
  })
})

describe('the Fiduciaries page', () => {
  it('sends anyone who is not staff to login', async () => {
    auth.role = 'client'
    await expect(FiduciariesPage()).rejects.toThrow('redirect:/auth/login')
  })

  it('links each matter to its People tab, gaps first', async () => {
    render(await FiduciariesPage())
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      `/admin/matters/${SMITH}?tab=people`,
      `/admin/matters/${JONES}?tab=people`,
    ])
    expect(links[0].textContent).toContain('2 gaps')
    expect(links[1].textContent).toContain('No gaps')
    expect(screen.getByText(/1 of 2 have a gap/)).toBeTruthy()
  })
})

describe('the matter’s fiduciaries card', () => {
  it('shows the matter’s gaps from the API', async () => {
    const view = await loadMatterFiduciaryView(asClient(seed()), SMITH)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ fiduciaries: view }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<MatterFiduciaryCard matterId={SMITH} planMirror={EMPTY_PLAN_MIRROR} />)
    await waitFor(() => expect(screen.getByTestId('fiduciary-issues')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/matters/${SMITH}/fiduciaries`)
    expect(screen.getByText(/has no successor/)).toBeTruthy()
    expect(screen.getByText(/no guardian is named/)).toBeTruthy()
  })

  it('says so when nothing is recorded, and when the check could not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ fiduciaries: { matterId: LEAD, title: 'x', issues: [], chains: [], people: [] } }), {
          status: 200,
        }),
      ),
    )
    const { unmount } = render(<MatterFiduciaryCard matterId={LEAD} planMirror={EMPTY_PLAN_MIRROR} />)
    await waitFor(() => expect(screen.getByText(/No appointments are recorded/)).toBeTruthy())
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Matter not found' }), { status: 404 })))
    render(<MatterFiduciaryCard matterId={LEAD} planMirror={EMPTY_PLAN_MIRROR} />)
    await waitFor(() => expect(screen.getByText('Matter not found')).toBeTruthy())
  })

  it('shows each design-sheet office beside what is recorded on people, and flags a difference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            fiduciaries: {
              matterId: SMITH,
              title: 'x',
              issues: [],
              chains: [{ roleKey: 'trustee', role: 'Trustee', forParty: 'client', people: [{ name: 'Riley Client', isCoagent: false }] }],
              people: [{ name: 'Riley Client', offices: ['Trustee'] }],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    render(
      <MatterFiduciaryCard
        matterId={SMITH}
        planMirror={{
          ...EMPTY_PLAN_MIRROR,
          fiduciaries: [{ key: 'trustee_slots', role: 'Trustee', primary: 'Morgan Client', successor: null }],
        }}
      />,
    )
    await waitFor(() => expect(screen.getByText('Differs')).toBeTruthy())
    const offices = screen.getByTestId('fiduciary-offices')
    expect(offices.textContent).toContain('Morgan Client')
    expect(offices.textContent).toContain('1. Riley Client')
  })
})
