// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const auth = vi.hoisted(() => ({
  claims: { id: 'staff-1' } as { id: string } | null,
  role: 'attorney' as string | null,
  staff: 'staff-1' as string | null,
  client: null as unknown,
}))
vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => auth.claims),
  getCachedUserRole: vi.fn(async () => auth.role),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => auth.client) }))
vi.mock('@/lib/serverActionAuth', () => ({
  requireAdminServerAction: vi.fn(async () => {
    if (!auth.staff) throw new Error('Unauthorized')
    return auth.staff
  }),
}))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    auth.staff
      ? { err: null, userId: auth.staff }
      : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null },
  ),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound')
  }),
}))

import FundingPage from '@/app/admin/funding/page'
import MatterFundingRedirect from '@/app/admin/funding/[matterId]/page'
import { GET as matterFunding } from '@/app/api/admin/matters/[id]/funding/route'
import { recordAssetFunding } from '@/app/admin/matters/[id]/tabs/funding/actions'
import { AssetRow } from '@/app/admin/matters/[id]/tabs/funding/AssetRow'
import type { FundingAsset } from '@/lib/funding/rollup'

const SMITH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const JONES = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function seed() {
  return makeFakeClient({
    matters: [
      { id: SMITH, name: 'Smith Estate Plan', stage: 'drafting', client_intake_id: 'i-smith', relationship_status: 'hired' },
      { id: JONES, name: 'Jones Estate Plan', stage: 'signing', client_intake_id: 'i-jones', relationship_status: 'hired' },
      { id: LEAD, name: 'Lee (lead)', stage: 'intake', client_intake_id: 'i-lee', relationship_status: 'lead' },
    ],
    asset_intake: [
      { id: 'a-house', client_intake_id: 'i-smith', category: 'real_estate', description: 'House', ownership: 'joint', value: 400000 },
      { id: 'a-ira', client_intake_id: 'i-smith', category: 'retirement', description: 'IRA', ownership: 'client', value: '250000' },
      { id: 'a-bank', client_intake_id: 'i-jones', category: 'bank', description: 'Checking', ownership: 'client', value: 1_200_000 },
      { id: 'a-lee', client_intake_id: 'i-lee', category: 'bank', description: 'Savings', ownership: 'client', value: 9_000_000 },
    ],
    asset_funding: [
      { matter_id: SMITH, asset_intake_id: 'a-ira', method: 'beneficiary', status: 'confirmed', confirmed_on: '2026-08-01', note: null },
    ],
  })
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.staff = 'staff-1'
  auth.client = seed()
})
afterEach(() => cleanup())

describe('/admin/funding', () => {
  it('sends a signed-out visitor to login', async () => {
    auth.claims = null
    await expect(FundingPage()).rejects.toThrow('redirect:/auth/login')
  })

  it('lists hired matters by unfunded dollars, and leaves leads out', async () => {
    render(await FundingPage())
    const rows = screen.getByTestId('funding-worklist').querySelectorAll('li')
    expect([...rows].map(row => row.textContent)).toEqual([
      expect.stringContaining('Jones Estate Plan'),
      expect.stringContaining('Smith Estate Plan'),
    ])
    expect(screen.queryByText('Lee (lead)')).not.toBeInTheDocument()
    expect(screen.getByText('$1,600,000')).toBeInTheDocument()
    expect(rows[1].querySelector('a')).toHaveAttribute('href', `/admin/matters/${SMITH}?tab=assets&view=funding`)
    expect(rows[1].textContent).toContain('1 of 2 outstanding')
  })
})

describe('/admin/funding/[matterId]', () => {
  it('redirects to the Funding view of the matter\'s Assets tab', async () => {
    await expect(MatterFundingRedirect({ params: Promise.resolve({ matterId: SMITH }) })).rejects.toThrow(
      `redirect:/admin/matters/${SMITH}?tab=assets&view=funding`,
    )
  })
})

describe('GET /api/admin/matters/[id]/funding', () => {
  const get = (id: string) => matterFunding(new Request('http://localhost'), { params: Promise.resolve({ id }) })

  it('returns each asset with what has been recorded, and the rest as suggestions', async () => {
    const response = await get(SMITH)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { assets: FundingAsset[]; summary: { unfundedValue: number; total: number } }
    expect(body.summary).toMatchObject({ unfundedValue: 400000, total: 2 })
    expect(body.assets.find(a => a.assetId === 'a-house')).toMatchObject({ method: 'deed', isRecorded: false })
    expect(body.assets.find(a => a.assetId === 'a-ira')).toMatchObject({ status: 'confirmed', confirmedOn: '2026-08-01' })
  })

  it('answers an empty list, not a 404, when a matter has nothing to track', async () => {
    const body = (await (await get(LEAD)).json()) as { assets: FundingAsset[] }
    expect(body.assets).toEqual([])
  })

  it('refuses a malformed id and a caller who is not staff', async () => {
    expect((await get('nope')).status).toBe(400)
    auth.staff = null
    expect((await get(SMITH)).status).toBe(403)
  })
})

describe('recordAssetFunding', () => {
  const base = { matterId: SMITH, assetId: 'a-house', category: 'real_estate', method: 'deed', status: 'in_progress' }

  it('refuses a caller who is not staff', async () => {
    auth.staff = null
    expect(await recordAssetFunding(null, form(base))).toEqual({ message: 'You are not signed in as staff.' })
  })

  it('refuses a retirement account recorded as retitled', async () => {
    const result = await recordAssetFunding(null, form({ ...base, assetId: 'a-ira', category: 'retirement', method: 'retitle' }))
    expect(result.message).toMatch(/taxable distribution/)
  })

  it('refuses confirmed with no confirmation date', async () => {
    const result = await recordAssetFunding(null, form({ ...base, status: 'confirmed' }))
    expect(result.message).toMatch(/Sent is not funded/)
  })

  it('refuses a value outside the vocabulary', async () => {
    expect(await recordAssetFunding(null, form({ ...base, method: 'sell_it' }))).toEqual({ message: 'Unknown funding method.' })
  })

  it('upserts the row with who recorded it', async () => {
    expect(await recordAssetFunding(null, form({ ...base, note: '  deed sent to registry  ' }))).toEqual({ message: null })
    const row = (auth.client as ReturnType<typeof makeFakeClient>)
      .tableRows('asset_funding')
      .find(r => r.asset_intake_id === 'a-house')
    expect(row).toMatchObject({ matter_id: SMITH, method: 'deed', status: 'in_progress', note: 'deed sent to registry', updated_by: 'staff-1', confirmed_on: null })
  })
})

describe('AssetRow', () => {
  const ira: FundingAsset = {
    assetId: 'a-ira',
    category: 'retirement',
    description: 'IRA',
    ownership: 'client',
    value: 250000,
    method: 'beneficiary',
    status: 'in_progress',
    confirmedOn: null,
    note: null,
    isRecorded: true,
  }

  it('never offers retitling or a deed for a retirement account', () => {
    render(<AssetRow matterId={SMITH} asset={ira} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const options = [...(screen.getByLabelText('How it joins the plan') as HTMLSelectElement).options].map(o => o.value)
    expect(options).not.toContain('retitle')
    expect(options).not.toContain('deed')
    expect(options).toContain('beneficiary')
  })

  it('asks for the confirmation date only once the status is confirmed', () => {
    render(<AssetRow matterId={SMITH} asset={ira} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(screen.queryByLabelText('Confirmation received')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'confirmed' } })
    expect(screen.getByLabelText('Confirmation received')).toBeRequired()
  })

  it('closes and asks the view to reload once a save succeeds', async () => {
    const onSaved = vi.fn()
    render(<AssetRow matterId={SMITH} asset={{ ...ira, assetId: 'a-house', category: 'real_estate', method: 'deed' }} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
