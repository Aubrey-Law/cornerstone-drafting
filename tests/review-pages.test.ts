import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedDatabase } from '@/types/supabase'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const auth = vi.hoisted(() => ({
  claims: { id: 'staff-1' } as { id: string } | null,
  role: 'attorney' as string | null,
  actionUser: 'staff-1' as string | null,
  client: null as unknown,
}))
vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => auth.claims),
  getCachedUserRole: vi.fn(async () => auth.role),
}))
vi.mock('@/lib/serverActionAuth', () => ({
  requireAdminServerAction: vi.fn(async () => {
    if (!auth.actionUser) throw new Error('Unauthorized')
    return auth.actionUser
  }),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => auth.client) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    auth.actionUser
      ? { err: null, userId: auth.actionUser }
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

import { loadRun, loadRunSummaries } from '@/lib/review/history'
import SavedReviewPage from '@/app/admin/review/[runId]/page'
import ReviewHistoryPage from '@/app/admin/review/page'
import { linkUpload, recordDisposition, retryRun, reviewUploadAgain } from '@/app/admin/review/[runId]/actions'
import { GET as matterReviews } from '@/app/api/admin/matters/[id]/reviews/route'
import { MATTER_TABS, parseMatterTab } from '@/lib/matterPageTabs'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UPLOAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEXT = 'The Trustee shall serve without bond.'

const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function run(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'review',
    matter_id: null,
    document_version_id: null,
    review_upload_id: null,
    text_layer_id: 'layer-1',
    prompt_version_id: 'v1',
    status: 'completed',
    rule_total: 1,
    finding_count: 1,
    failed_count: 0,
    failures: [],
    started_at: '2026-09-26T10:00:00Z',
    finished_at: '2026-09-26T10:01:00Z',
    model: null,
    render_version: 1,
    resolved_inputs: null,
    ...overrides,
  }
}

function seed() {
  return makeFakeClient({
    prompts: [{ id: 'p1', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' }],
    prompt_publications: [{ prompt_id: 'p1', version_id: 'v1' }],
    prompt_versions: [
      {
        id: 'v1',
        prompt_id: 'p1',
        version_number: 1,
        body: { kind: 'review', inputs: [], rules: [{ number: '1', risk: 'medium', statement: 'Bond is waived.' }] },
      },
    ],
    matters: [
      { id: MATTER, name: 'Smith Estate Plan' },
      { id: OTHER, name: 'Jones Estate Plan' },
    ],
    review_uploads: [
      { id: UPLOAD, label: 'Smith trust draft', filename: 'smith.docx', file_kind: 'docx', r2_key: 'k', matter_id: MATTER, origin: 'word' },
    ],
    document_text_layers: [
      {
        id: 'layer-1',
        review_upload_id: UPLOAD,
        document_version_id: null,
        source_kind: 'plain',
        status: 'ok',
        extractor: 'word-paragraphs',
        extractor_version: '1',
        source_sha256: 'a'.repeat(64),
        page_count: null,
        text: TEXT,
        blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
        spans: [],
      },
    ],
    workflow_runs: [
      run('run-word', { review_upload_id: UPLOAD, started_at: '2026-09-26T12:00:00Z' }),
      run('run-filed', { matter_id: MATTER, document_version_id: 'dv1', started_at: '2026-09-26T11:00:00Z' }),
      run('run-other', { matter_id: OTHER, document_version_id: 'dv2', started_at: '2026-09-26T10:00:00Z' }),
    ],
    workflow_findings: [
      { id: 'f1', run_id: 'run-word', rule_number: '1', outcome: 'deviation', severity: 'medium', rationale: 'r', disposition: 'open' },
    ],
    workflow_run_steps: [{ run_id: 'run-word', unit_id: '1', sequence: 0, status: 'succeeded', attempts: 1, finding_id: 'f1' }],
  })
}

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.actionUser = 'staff-1'
  auth.client = asClient(seed())
})

describe('a matter’s reviews', () => {
  it('are its filed documents’ reviews and those of uploads linked to it, never another matter’s', async () => {
    const summaries = await loadRunSummaries(asClient(seed()), 25, { matterId: MATTER })
    expect(summaries.map(s => s.runId).sort()).toEqual(['run-filed', 'run-word'])
    expect(summaries.find(s => s.runId === 'run-word')?.matterTitle).toBe('Smith Estate Plan · from Word')
  })

  it('refuse a matter id that is not a uuid, since it is interpolated into a filter', async () => {
    expect(await loadRunSummaries(asClient(seed()), 25, { matterId: `${MATTER},kind.eq.field_audit` })).toEqual([])
  })

  it('are served to staff by the matter’s reviews route', async () => {
    const response = await matterReviews(new Request('http://localhost'), { params: Promise.resolve({ id: MATTER }) })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { reviews: Array<{ runId: string }> }
    expect(body.reviews.map(r => r.runId).sort()).toEqual(['run-filed', 'run-word'])

    expect((await matterReviews(new Request('http://localhost'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400)
    auth.actionUser = null
    expect((await matterReviews(new Request('http://localhost'), { params: Promise.resolve({ id: MATTER }) })).status).toBe(403)
  })

  it('have a tab on the matter page, opened by ?tab=reviews', () => {
    expect(MATTER_TABS).toContain('reviews')
    expect(parseMatterTab('reviews')).toBe('reviews')
  })
})

describe('the review pages', () => {
  it('send anyone who is not staff to login before any query', async () => {
    const client = seed()
    auth.client = asClient(client)
    for (const [claims, role] of [[null, null], [{ id: 'c1' }, 'client']] as const) {
      auth.claims = claims
      auth.role = role
      await expect(ReviewHistoryPage()).rejects.toThrow('redirect:/auth/login')
      await expect(SavedReviewPage({ params: Promise.resolve({ runId: 'run-word' }) })).rejects.toThrow('redirect:/auth/login')
    }
  })

  it('render a saved review, and 404 a run that is not a review', async () => {
    const element = await SavedReviewPage({ params: Promise.resolve({ runId: 'run-word' }) })
    expect(element).toBeTruthy()
    await expect(SavedReviewPage({ params: Promise.resolve({ runId: 'missing' }) })).rejects.toThrow('notFound')
  })

  it('read a Word review back with its snapshot, stored text and linked matter', async () => {
    const stored = await loadRun(asClient(seed()), 'run-word')
    expect(stored).toMatchObject({
      reviewUploadId: UPLOAD,
      documentLabel: 'Smith trust draft',
      uploadMatterId: MATTER,
      uploadMatterTitle: 'Smith Estate Plan',
      uploadFromWord: true,
    })
    expect(stored?.layer?.text).toBe(TEXT)
  })
})

describe('the saved review’s actions', () => {
  function form(values: Record<string, string>) {
    const data = new FormData()
    for (const [key, value] of Object.entries(values)) data.set(key, value)
    return data
  }

  it('refuse a caller who is not staff, writing nothing', async () => {
    const client = seed()
    auth.client = asClient(client)
    auth.actionUser = null
    expect(await recordDisposition(null, form({ findingId: 'f1', disposition: 'accepted', runId: 'run-word' }))).toEqual({
      message: 'You are not signed in as staff.',
    })
    expect(await linkUpload({ ok: null, message: null }, form({ reviewUploadId: UPLOAD, matterId: '' }))).toMatchObject({ ok: false })
    expect(await reviewUploadAgain(UPLOAD, 'ma-trust-firm-qa')).toMatchObject({ ok: false })
    expect(client.tableRows('workflow_findings')[0].disposition).toBe('open')
    expect(client.tableRows('review_uploads')[0].matter_id).toBe(MATTER)
    expect(client.tableRows('workflow_runs')).toHaveLength(3)
  })

  it('record a decision on a finding, as the signed-in attorney', async () => {
    const client = seed()
    auth.client = asClient(client)
    expect(await recordDisposition(null, form({ findingId: 'f1', disposition: 'accepted', runId: 'run-word' }))).toEqual({ message: null })
    expect(client.tableRows('workflow_findings')[0]).toMatchObject({ disposition: 'accepted', disposition_by: 'staff-1' })
  })

  it('requeue only the rules a review lost', async () => {
    const client = seed()
    client.tableRows('workflow_runs')[0].status = 'partial'
    client.tableRows('workflow_run_steps').push({ run_id: 'run-word', unit_id: '2', sequence: 1, status: 'failed', attempts: 1, last_error: 'overloaded' })
    auth.client = asClient(client)
    expect(await retryRun({ message: null }, form({ runId: 'run-word' }))).toEqual({ message: null })
    const steps = client.tableRows('workflow_run_steps').filter(step => step.run_id === 'run-word')
    expect(steps.map(step => [step.unit_id, step.status])).toEqual([
      ['1', 'succeeded'],
      ['2', 'pending'],
    ])
    expect(client.tableRows('workflow_runs')[0].status).toBe('queued')
  })

  it('queue another review of the snapshot from its stored text, for the tick to work', async () => {
    const client = seed()
    auth.client = asClient(client)
    const result = await reviewUploadAgain(UPLOAD, 'ma-trust-firm-qa')
    expect(result).toMatchObject({ ok: true })
    const queued = client.tableRows('workflow_runs').find(row => row.id === (result.ok ? result.runId : null))
    expect(queued).toMatchObject({ status: 'queued', review_upload_id: UPLOAD, text_layer_id: 'layer-1', matter_id: null })
    expect(await reviewUploadAgain(UPLOAD, 'no-such-playbook')).toMatchObject({ ok: false })
  })
})
