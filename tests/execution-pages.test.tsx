// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

import ExecutionPage from '@/app/admin/execution/page'
import MatterExecutionRedirect from '@/app/admin/execution/[matterId]/page'
import { GET as matterSigning } from '@/app/api/admin/matters/[id]/signing/route'
import { recordCeremony, recordCeremonyDocument } from '@/app/admin/matters/[id]/tabs/signing/ceremonyActions'

const SMITH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const JONES = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function seed() {
  return makeFakeClient({
    matters: [
      { id: SMITH, name: 'Smith Estate Plan', stage: 'signing', relationship_status: 'hired' },
      { id: JONES, name: 'Jones Estate Plan', stage: 'drafting', relationship_status: 'hired' },
      { id: LEAD, name: 'Lee (lead)', stage: 'intake', relationship_status: 'lead' },
    ],
    matter_documents: [
      { matter_id: SMITH, name: 'Smith Last Will and Testament.docx', superseded_at: null },
      { matter_id: SMITH, name: 'Smith Health Care Proxy.docx', superseded_at: null },
      { matter_id: SMITH, name: 'Scan 0042.pdf', superseded_at: null },
      { matter_id: SMITH, name: 'Old Will.docx', superseded_at: '2026-01-01T00:00:00Z' },
      { matter_id: LEAD, name: 'Lee Will.docx', superseded_at: null },
    ],
    signing_ceremonies: [
      { id: 'cer-jones', matter_id: JONES, status: 'scheduled', created_at: '2026-09-01T00:00:00Z' },
    ],
    ceremony_documents: [],
  })
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const fake = () => auth.client as ReturnType<typeof makeFakeClient>

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.staff = 'staff-1'
  auth.client = seed()
})
afterEach(() => cleanup())

describe('/admin/execution', () => {
  it('sends a client to login', async () => {
    auth.role = 'client'
    await expect(ExecutionPage()).rejects.toThrow('redirect:/auth/login')
  })

  it('lists hired matters with current documents, and what it could not place', async () => {
    render(await ExecutionPage())
    const rows = [...screen.getByTestId('execution-worklist').querySelectorAll('li')]
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Smith Estate Plan')
    expect(rows[0].textContent).toContain('2 documents recognised')
    expect(rows[0].textContent).toContain('1 to confirm')
    expect(rows[0].querySelector('a')).toHaveAttribute('href', `/admin/matters/${SMITH}?tab=documents&view=signing`)
  })
})

describe('/admin/execution/[matterId]', () => {
  it('redirects to the Signing view of the matter\'s Documents tab', async () => {
    await expect(MatterExecutionRedirect({ params: Promise.resolve({ matterId: SMITH }) })).rejects.toThrow(
      `redirect:/admin/matters/${SMITH}?tab=documents&view=signing`,
    )
  })
})

describe('GET /api/admin/matters/[id]/signing', () => {
  const get = (id: string) => matterSigning(new Request('http://localhost'), { params: Promise.resolve({ id }) })

  it('returns what the drafts need to be signed, and what it could not place', async () => {
    const response = await get(SMITH)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { signing: { kinds: string[]; unmatched: string[]; ceremony: unknown } }
    expect(body.signing.kinds).toHaveLength(2)
    expect(body.signing.unmatched).toEqual([expect.stringMatching(/Scan 0042\.pdf/)])
    expect(body.signing.ceremony).toBeNull()
  })

  it('answers signing: null for a matter that is not hired', async () => {
    expect(await (await get(LEAD)).json()).toEqual({ signing: null })
  })

  it('refuses a malformed id and a caller who is not staff', async () => {
    expect((await get('x')).status).toBe(400)
    auth.staff = null
    expect((await get(SMITH)).status).toBe(403)
  })
})

describe('ceremony actions', () => {
  it('refuse a caller who is not staff', async () => {
    auth.staff = null
    expect(await recordCeremony(null, form({ matterId: SMITH }))).toEqual({ message: 'You are not signed in as staff.' })
    expect(await recordCeremonyDocument(null, form({ matterId: SMITH }))).toEqual({ message: 'You are not signed in as staff.' })
  })

  it('creates the appointment with who created it', async () => {
    expect(await recordCeremony(null, form({ matterId: SMITH, status: 'scheduled', location: 'Office' }))).toEqual({ message: null })
    const created = fake().tableRows('signing_ceremonies').find(r => r.matter_id === SMITH)
    expect(created).toMatchObject({ location: 'Office', status: 'scheduled', created_by: 'staff-1', completed_at: null })
  })

  it('will not update another matter’s appointment', async () => {
    const result = await recordCeremony(null, form({ matterId: SMITH, ceremonyId: 'cer-jones', status: 'cancelled' }))
    expect(result.message).not.toBeNull()
    expect(fake().tableRows('signing_ceremonies').find(r => r.id === 'cer-jones')).toMatchObject({ matter_id: JONES, status: 'scheduled' })
  })

  it('will not record a document against another matter’s appointment', async () => {
    const result = await recordCeremonyDocument(null, form({ matterId: SMITH, ceremonyId: 'cer-jones', documentKind: 'will', witnessCount: '2' }))
    expect(result).toEqual({ message: 'That signing appointment is not on this matter.' })
    expect(fake().tableRows('ceremony_documents')).toHaveLength(0)
  })

  it('refuses a signed document with no signing date', async () => {
    const result = await recordCeremonyDocument(null, form({ matterId: JONES, ceremonyId: 'cer-jones', documentKind: 'will', witnessCount: '2', executed: 'on' }))
    expect(result.message).toMatch(/needs the date it was signed/)
  })

  it('records a signed document on its own matter’s appointment', async () => {
    const result = await recordCeremonyDocument(
      null,
      form({ matterId: JONES, ceremonyId: 'cer-jones', documentKind: 'will', witnessCount: '2', executed: 'on', signedOn: '2026-09-20' }),
    )
    expect(result).toEqual({ message: null })
    expect(fake().tableRows('ceremony_documents')[0]).toMatchObject({ ceremony_id: 'cer-jones', document_kind: 'will', executed: true, signed_on: '2026-09-20', witness_count: 2 })
  })
})
