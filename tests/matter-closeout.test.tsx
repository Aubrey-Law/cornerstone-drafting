// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { GeneratedDatabase } from '@/types/supabase'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const auth = vi.hoisted(() => ({
  claims: { id: 'staff-1' } as { id: string } | null,
  role: 'attorney' as string | null,
  client: null as unknown,
}))
vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => auth.claims),
  getCachedUserRole: vi.fn(async () => auth.role),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => auth.client) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound')
  }),
}))

import { adminNavItems } from '@/app/admin/AdminLayoutClient'
import { isNavItemActive } from '@/app/admin/components/AdminSidebar'
import ExecutionPage from '@/app/admin/execution/page'
import { MatterCloseoutCard } from '@/app/admin/matters/(overview)/MatterCloseoutCard'
import { loadCeremonyStatuses } from '@/lib/ceremony/repository'
import { loadMatterCloseoutSummary } from '@/lib/matters/closeout'

const SMITH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const JONES = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function seed() {
  return makeFakeClient({
    matters: [
      { id: SMITH, name: 'Smith Estate Plan', stage: 'signing', client_intake_id: 'i-smith', relationship_status: 'hired' },
      { id: JONES, name: 'Jones Estate Plan', stage: 'funding', client_intake_id: 'i-jones', relationship_status: 'hired' },
    ],
    asset_intake: [
      { id: 'a-house', client_intake_id: 'i-smith', category: 'real_estate', description: 'House', ownership: 'joint', value: 400000 },
      { id: 'a-bank', client_intake_id: 'i-jones', category: 'bank', description: 'Checking', ownership: 'client', value: 50000 },
    ],
    asset_funding: [
      { matter_id: JONES, asset_intake_id: 'a-bank', method: 'retitle', status: 'confirmed', confirmed_on: '2026-08-01', note: null },
    ],
    matter_documents: [
      { matter_id: SMITH, name: 'Smith Last Will and Testament.docx', superseded_at: null },
      { matter_id: SMITH, name: 'Scan 0042.pdf', superseded_at: null },
      { matter_id: JONES, name: 'Jones Revocable Trust.docx', superseded_at: null },
    ],
    signing_ceremonies: [
      { id: 'cer-old', matter_id: JONES, status: 'scheduled', created_at: '2026-07-01T00:00:00Z' },
      { id: 'cer-new', matter_id: JONES, status: 'completed', created_at: '2026-08-01T00:00:00Z' },
    ],
    contacts: [{ id: 'c-anne', first_name: 'Anne', middle_name: null, last_name: 'Smith' }],
    contact_roles: [
      { contact_id: 'c-anne', role: 'trustee', for_party: 'client', priority: 1, is_coagent: false, matter_id: SMITH, client_intake_id: null },
    ],
    matter_contacts: [],
    workflow_findings: [],
  })
}

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.client = asClient(seed())
})
afterEach(() => cleanup())

describe('loadCeremonyStatuses', () => {
  it('reads each matter’s latest signing, and leaves out a matter with none', async () => {
    const statuses = await loadCeremonyStatuses(asClient(seed()), [SMITH, JONES])
    expect(statuses.get(JONES)).toBe('completed')
    expect(statuses.has(SMITH)).toBe(false)
  })
})

describe('loadMatterCloseoutSummary', () => {
  it('counts what is unfunded, unsigned, missing a fiduciary, and blocked', async () => {
    expect(await loadMatterCloseoutSummary(asClient(seed()))).toEqual({
      funding: { unfundedValue: 400000, mattersOutstanding: 1 },
      // Jones is signed; Smith is drafted and not, with one file it could not place.
      signing: { mattersToSign: 1, documentsToConfirm: 1 },
      fiduciaries: { mattersWithGaps: 1, mattersTracked: 1 },
      blockers: { matters: 0 },
    })
  })

  it('costs one number, not the dashboard, when a read fails', async () => {
    const client = seed()
    client.failTable('asset_intake', 'boom')
    const summary = await loadMatterCloseoutSummary(asClient(client))
    expect(summary.funding).toBeNull()
    expect(summary.signing).not.toBeNull()
  })
})

describe('MatterCloseoutCard', () => {
  it('links each figure to its worklist, and says so when one could not be read', () => {
    render(
      <MatterCloseoutCard
        summary={{
          funding: { unfundedValue: 400000, mattersOutstanding: 1 },
          signing: { mattersToSign: 2, documentsToConfirm: 0 },
          fiduciaries: null,
          blockers: { matters: 1 },
        }}
      />,
    )
    expect(screen.getByTestId('closeout-funding')).toHaveAttribute('href', '/admin/funding')
    expect(screen.getByTestId('closeout-funding')).toHaveTextContent('$400,000')
    expect(screen.getByTestId('closeout-signing')).toHaveAttribute('href', '/admin/execution')
    expect(screen.getByTestId('closeout-fiduciaries')).toHaveTextContent('Could not be read')
    expect(screen.getByTestId('closeout-blockers')).toHaveAttribute('href', '/admin/field-audits')
  })
})

describe('/admin/execution', () => {
  it('lists what is still to sign first, with each matter’s signing status', async () => {
    render(await ExecutionPage())
    const rows = within(screen.getByTestId('execution-worklist')).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Smith Estate Plan'),
      expect.stringContaining('Jones Estate Plan'),
    ])
    expect(rows[1]).toHaveTextContent('Signed')
  })
})

describe('the admin navigation', () => {
  it('no longer gives the close-out worklists places of their own', () => {
    const hrefs = adminNavItems.map(item => item.href)
    for (const href of ['/admin/funding', '/admin/execution', '/admin/fiduciaries', '/admin/field-audits']) {
      expect(hrefs).not.toContain(href)
    }
    expect(hrefs).toContain('/admin/overview')
    expect(hrefs).not.toContain('/admin/review')
  })

  it('highlights the item that owns a worklist while it is open', () => {
    const matters = { href: '/admin/matters/list' }
    const reviews = { href: '/admin/overview' }
    expect(isNavItemActive(matters, '/admin/funding')).toBe(true)
    expect(isNavItemActive(matters, '/admin/execution')).toBe(true)
    expect(isNavItemActive(matters, '/admin/fiduciaries')).toBe(true)
    expect(isNavItemActive(reviews, '/admin/field-audits/run-1')).toBe(true)
    expect(isNavItemActive(reviews, '/admin/playbooks')).toBe(true)
    expect(isNavItemActive(reviews, '/admin/funding')).toBe(false)
  })
})
