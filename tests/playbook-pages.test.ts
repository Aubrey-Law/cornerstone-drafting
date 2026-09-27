import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedDatabase } from '@/types/supabase'
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
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    auth.staff
      ? { err: null, userId: auth.staff }
      : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null },
  ),
}))
vi.mock('@/lib/serverActionAuth', () => ({
  requireAdminServerAction: vi.fn(async () => {
    if (!auth.staff) throw new Error('Unauthorized')
    return auth.staff
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
}))
// Extraction is the citations package's job and tested there (and in
// playbook-extract.test.ts); here only the route's own decisions are.
const extract = vi.hoisted(() => ({
  extractCandidateRules: vi.fn(async () => ({ candidates: [{ statement: 'Bond is waived.', risk: 'medium' }], failures: [] })),
}))
vi.mock('@aubrey-law/citations/playbookBuilder/extractRules', () => extract)
vi.mock('@/lib/review/run', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/review/run')>()),
  buildLayer: vi.fn(async () => ({ status: 'ok', blocks: [{ index: 0 }, { index: 1 }], text: 'x', spans: [] })),
}))

import { POST as extractRoute } from '@/app/api/admin/playbooks/extract/route'
import { publishPlaybook } from '@/app/admin/playbooks/actions'
import PlaybooksPage from '@/app/admin/playbooks/page'
import NewReviewPage from '@/app/admin/review/new/page'

const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function seed() {
  const body = (statement: string) => ({ kind: 'review', inputs: [], rules: [{ number: '1', risk: 'medium', statement }] })
  return makeFakeClient({
    prompts: [
      { id: 'p1', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' },
      { id: 'p2', slug: 'ma-will-firm-qa', title: 'Will review', kind: 'review' },
    ],
    prompt_publications: [
      { prompt_id: 'p1', version_id: 'v1' },
      { prompt_id: 'p2', version_id: 'v2' },
    ],
    prompt_versions: [
      { id: 'v1', prompt_id: 'p1', version_number: 1, body: body('Bond is waived.') },
      { id: 'v2', prompt_id: 'p2', version_number: 4, body: body('A guardian is named.') },
    ],
    matters: [],
  })
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY
beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.staff = 'staff-1'
  auth.client = asClient(seed())
  process.env.ANTHROPIC_API_KEY = 'test-key'
  vi.clearAllMocks()
})
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY
})

function upload(name = 'Trust form.docx', extra: Record<string, string> = {}) {
  const form = new FormData()
  form.set('document', new File([new Uint8Array([0x50, 0x4b, 3, 4])], name))
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return new Request('http://localhost/api/admin/playbooks/extract', { method: 'POST', body: form })
}

describe('POST /api/admin/playbooks/extract', () => {
  it('proposes rules from a precedent as the signed-in attorney, and stores nothing', async () => {
    const response = await extractRoute(upload('Trust form.docx', { documentType: 'Revocable trust' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ filename: 'Trust form.docx', paragraphCount: 2, candidates: [{ statement: 'Bond is waived.' }] })
    expect(extract.extractCandidateRules).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'staff-1', documentType: 'Revocable trust' }),
    )
  })

  it('refuses a caller who is not staff, a file it cannot read, and a missing model key', async () => {
    auth.staff = null
    expect((await extractRoute(upload())).status).toBe(403)
    auth.staff = 'staff-1'
    expect((await extractRoute(upload('notes.txt'))).status).toBe(400)
    delete process.env.ANTHROPIC_API_KEY
    const response = await extractRoute(upload())
    expect(response.status).toBe(503)
    expect(extract.extractCandidateRules).not.toHaveBeenCalled()
  })
})

describe('publishPlaybook', () => {
  const input = {
    slug: 'ma-trust-firm-qa',
    title: 'Trust review',
    changeSummary: 'Adds the bond rule',
    rules: [{ statement: 'Bond is waived.', risk: 'medium' as const, preferredLanguage: null, conditions: [] }],
  }

  it('publishes a new version as the signed-in attorney', async () => {
    const client = seed()
    auth.client = asClient(client)
    expect(await publishPlaybook(input)).toEqual({ ok: true, slug: 'ma-trust-firm-qa', versionNumber: 2, ruleCount: 1 })
    expect(client.tableRows('prompt_versions').find(row => row.version_number === 2)).toMatchObject({
      prompt_id: 'p1',
      created_by: 'staff-1',
      change_summary: 'Adds the bond rule',
    })
  })

  it('refuses a caller who is not staff, and a rule with no statement, writing nothing', async () => {
    const client = seed()
    auth.client = asClient(client)
    auth.staff = null
    expect(await publishPlaybook(input)).toEqual({ ok: false, message: 'You are not signed in as staff.' })
    auth.staff = 'staff-1'
    expect(await publishPlaybook({ ...input, rules: [{ ...input.rules[0], statement: ' ' }] })).toMatchObject({ ok: false })
    expect(client.tableRows('prompt_versions')).toHaveLength(2)
  })
})

describe('the builder and Start a review pages', () => {
  it('send anyone who is not staff to login', async () => {
    auth.role = 'client'
    await expect(PlaybooksPage()).rejects.toThrow('redirect:/auth/login')
  })

  it('hand the builder every published review playbook to start from', async () => {
    const element = (await PlaybooksPage()) as { props: { playbooks: Array<{ slug: string; version: number }> } }
    expect(element.props.playbooks.map(p => [p.slug, p.version]).sort()).toEqual([
      ['ma-trust-firm-qa', 1],
      ['ma-will-firm-qa', 4],
    ])
  })

  it('preselect the playbook the builder just published, via ?playbook=', async () => {
    const formOf = async (playbook?: string) => {
      const element = (await NewReviewPage({ searchParams: Promise.resolve(playbook ? { playbook } : {}) })) as {
        props: { children: Array<{ props?: Record<string, unknown> } | false | null> }
      }
      const form = element.props.children.find(child => child && child.props && 'defaultSlug' in child.props) as {
        props: { defaultSlug: string }
      }
      return form.props.defaultSlug
    }
    expect(await formOf('ma-will-firm-qa')).toBe('ma-will-firm-qa')
    // An unknown slug falls back to the default rather than preselecting nothing.
    expect(await formOf('no-such-playbook')).toBe('ma-trust-firm-qa')
  })
})
