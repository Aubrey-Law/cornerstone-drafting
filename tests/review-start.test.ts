import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedDatabase } from '@/types/supabase'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const TEXT = 'The Trustee shall serve without bond.'
const LAYER = {
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'test',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: TEXT,
  blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
  spans: [],
}
// Extraction is the citations package's job and tested there; here a file's
// bytes say which layer it yields.
vi.mock('@/lib/review/run', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/review/run')>()),
  buildLayer: vi.fn(async (bytes: Buffer, kind: string) =>
    bytes.toString() === 'scan' ? { ...LAYER, sourceKind: kind, status: 'no_text', text: '', blocks: [] } : { ...LAYER, sourceKind: kind },
  ),
}))

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
vi.mock('@/lib/documentApiHelpers', () => ({ loadR2Bytes: vi.fn(async () => Buffer.from('docx bytes')) }))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => undefined) }))
vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: vi.fn(async () => undefined) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
}))

import { startReview } from '@/lib/review/startReview'
import { POST } from '@/app/api/admin/review/route'
import NewReviewPage from '@/app/admin/review/new/page'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function seed() {
  return makeFakeClient({
    prompts: [{ id: 'p1', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' }],
    prompt_publications: [{ prompt_id: 'p1', version_id: 'v1' }],
    prompt_versions: [
      {
        id: 'v1',
        prompt_id: 'p1',
        version_number: 1,
        body: {
          kind: 'review',
          inputs: [],
          rules: [
            { number: '1', risk: 'medium', statement: 'Bond is waived.' },
            { number: '2', risk: 'high', statement: 'Guardians are named.' },
          ],
        },
      },
    ],
    matters: [{ id: MATTER, name: 'Smith Estate Plan', relationship_status: 'hired' }],
    matter_documents: [{ id: 'd1', matter_id: MATTER, name: 'Smith Trust.docx', superseded_at: null }],
    document_versions: [
      { id: 'dv1', document_id: 'd1', version_number: 2, r2_key: 'matters/k.docx', pdf_r2_key: null, filename: 'Smith Trust.docx', deleted_at: null },
    ],
    design_sheets: [{ matter_id: MATTER, marital_status: 'married', is_joint: true, children: [], plan_type: 'trust', assets: [] }],
  })
}

const storage = { write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
const read = vi.fn(async () => Buffer.from('docx bytes'))

beforeEach(() => {
  vi.clearAllMocks()
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.apiUser = 'staff-1'
})

describe('startReview', () => {
  it('queues a review of a filed document with its matter, its facts pinned, and a pending step per rule', async () => {
    const client = seed()
    const result = await startReview(asClient(client), { subject: { documentVersionId: 'dv1' }, playbookSlug: 'ma-trust-firm-qa', userId: 'staff-1' }, { read })
    expect(result).toMatchObject({ ok: true, matterId: MATTER, reviewUploadId: null, ruleTotal: 2 })
    // Read by the key the database holds, never one the browser sent.
    expect(read).toHaveBeenCalledWith('matters/k.docx')

    const [run] = client.tableRows('workflow_runs')
    expect(run).toMatchObject({
      matter_id: MATTER,
      document_version_id: 'dv1',
      review_upload_id: null,
      prompt_version_id: 'v1',
      status: 'queued',
      rule_total: 2,
      created_by: 'staff-1',
    })
    expect(run.resolved_inputs).toMatchObject({ matterFacts: expect.objectContaining({ married: true }) })
    expect(client.tableRows('document_text_layers')[0]).toMatchObject({ document_version_id: 'dv1', text: TEXT })
    expect(client.tableRows('workflow_run_steps').map(step => [step.unit_id, step.status])).toEqual([
      ['1', 'pending'],
      ['2', 'pending'],
    ])
  })

  it('keeps an upload and queues its review with no matter', async () => {
    const client = seed()
    const result = await startReview(
      asClient(client),
      { subject: { upload: { bytes: Buffer.from('docx bytes'), filename: 'Jones Will.docx', label: 'Jones — 2019 will' } }, playbookSlug: 'ma-trust-firm-qa', userId: 'staff-1' },
      { read, uploadStorage: storage },
    )
    expect(result).toMatchObject({ ok: true, matterId: null })
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(client.tableRows('review_uploads')[0]).toMatchObject({ label: 'Jones — 2019 will', file_kind: 'docx' })
    expect(client.tableRows('workflow_runs')[0]).toMatchObject({ matter_id: null, document_version_id: null, status: 'queued', resolved_inputs: null })
  })

  it('refuses what it cannot review or record, and writes no run', async () => {
    const cases: Array<[Parameters<typeof startReview>[1], number]> = [
      [{ subject: { documentVersionId: 'someone-elses' }, playbookSlug: 'ma-trust-firm-qa', userId: 'u' }, 404],
      [{ subject: { documentVersionId: 'dv1' }, playbookSlug: 'no-such-playbook', userId: 'u' }, 503],
      [{ subject: { upload: { bytes: Buffer.from('x'), filename: 'notes.txt', label: '' } }, playbookSlug: 'ma-trust-firm-qa', userId: 'u' }, 422],
      [{ subject: { upload: { bytes: Buffer.from('scan'), filename: 'scan.pdf', label: '' } }, playbookSlug: 'ma-trust-firm-qa', userId: 'u' }, 422],
    ]
    for (const [input, status] of cases) {
      const client = seed()
      const result = await startReview(asClient(client), input, { read, uploadStorage: storage })
      expect(result).toMatchObject({ ok: false, status })
      expect(client.tableRows('workflow_runs')).toEqual([])
    }
  })

  it('says so when the filed document cannot be read from storage', async () => {
    const result = await startReview(
      asClient(seed()),
      { subject: { documentVersionId: 'dv1' }, playbookSlug: 'ma-trust-firm-qa', userId: 'u' },
      { read: vi.fn(async () => { throw new Error('NoSuchKey') }) },
    )
    expect(result).toMatchObject({ ok: false, status: 502, message: expect.stringContaining('NoSuchKey') })
  })
})

describe('POST /api/admin/review', () => {
  function post(fields: Record<string, string | File>) {
    const body = new FormData()
    for (const [key, value] of Object.entries(fields)) body.set(key, value)
    return new Request('http://localhost/api/admin/review', { method: 'POST', body })
  }

  it('starts a review of a filed document as the signed-in attorney', async () => {
    const client = seed()
    auth.client = asClient(client)
    const response = await POST(post({ playbookSlug: 'ma-trust-firm-qa', documentVersionId: 'dv1' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { runId: string }
    expect(client.tableRows('workflow_runs')[0]).toMatchObject({ id: body.runId, created_by: 'staff-1' })
  })

  it('refuses a caller who is not staff, and a form missing its playbook or document', async () => {
    auth.client = asClient(seed())
    auth.apiUser = null
    expect((await POST(post({ playbookSlug: 'ma-trust-firm-qa', documentVersionId: 'dv1' }))).status).toBe(403)
    auth.apiUser = 'staff-1'
    expect((await POST(post({ documentVersionId: 'dv1' }))).status).toBe(400)
    expect((await POST(post({ playbookSlug: 'ma-trust-firm-qa' }))).status).toBe(400)
  })
})

describe('the Start a review page', () => {
  it('sends anyone who is not staff to login', async () => {
    auth.client = asClient(seed())
    auth.role = 'client'
    await expect(NewReviewPage({})).rejects.toThrow('redirect:/auth/login')
  })

  it('offers hired matters’ current documents and published playbooks, preselecting ?matter=', async () => {
    auth.client = asClient(seed())
    const element = (await NewReviewPage({ searchParams: Promise.resolve({ matter: MATTER }) })) as {
      props: { children: Array<{ props?: Record<string, unknown> } | false | null> }
    }
    const form = element.props.children.find(child => child && child.props && 'matters' in child.props) as {
      props: { matters: unknown; initialMatterId: string; defaultSlug: string; playbooks: Array<{ rules: unknown[] }> }
    }
    expect(form.props.initialMatterId).toBe(MATTER)
    expect(form.props.defaultSlug).toBe('ma-trust-firm-qa')
    expect(form.props.matters).toEqual([
      { matterId: MATTER, title: 'Smith Estate Plan', documents: [{ versionId: 'dv1', name: 'Smith Trust.docx' }] },
    ])
    expect(form.props.playbooks[0].rules).toHaveLength(2)
  })
})
