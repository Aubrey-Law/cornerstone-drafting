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
// Resolving a prompt's inputs against a design sheet is `runMatterAudit`'s job
// and tested in field-audit-run.test.ts; here only the action's own decisions are.
const audit = vi.hoisted(() => ({
  runMatterAudit: vi.fn(async () => ({ ok: true as const, runId: 'run-new' })),
}))
vi.mock('@/lib/fieldAudit/run', () => audit)
vi.mock('@/lib/prompts/designSheet', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/prompts/designSheet')>()),
  loadMattersWithDesignSheets: vi.fn(async () => [{ matterId: 'm1', title: 'Smith Estate Plan' }]),
}))

import { runAudit } from '@/app/admin/field-audits/actions'
import { recordFieldAuditDisposition, retryRun } from '@/app/admin/field-audits/[runId]/actions'
import FieldAuditsPage from '@/app/admin/field-audits/page'
import FieldAuditRunPage from '@/app/admin/field-audits/[runId]/page'
import { GET as matterFieldAudits } from '@/app/api/admin/matters/[id]/field-audits/route'

const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function seed() {
  return makeFakeClient({
    prompts: [
      { id: 'p1', slug: 'ma-design-sheet-audit', title: 'Design sheet audit', kind: 'field_audit' },
      { id: 'p2', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' },
    ],
    prompt_publications: [
      { prompt_id: 'p1', version_id: 'v1' },
      { prompt_id: 'p2', version_id: 'v2' },
    ],
    prompt_versions: [
      {
        id: 'v1',
        prompt_id: 'p1',
        version_number: 2,
        body: {
          kind: 'field_audit',
          inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: false }],
          outputTarget: 'task_set',
          checks: [
            {
              number: '1',
              statement: 'A trustee is named.',
              risk: 'blocker',
              reads: ['concerns'],
              taskTemplate: { title: 'Name a trustee', description: 'Add a trustee to the sheet.', priority: 'high' },
            },
          ],
        },
      },
      {
        id: 'v2',
        prompt_id: 'p2',
        version_number: 1,
        body: { kind: 'review', inputs: [], rules: [{ number: '1', risk: 'medium', statement: 'Bond is waived.' }] },
      },
    ],
    matters: [{ id: 'm1', name: 'Smith Estate Plan' }],
    workflow_runs: [
      {
        id: 'run-audit',
        kind: 'field_audit',
        matter_id: 'm1',
        prompt_version_id: 'v1',
        status: 'completed',
        rule_total: 1,
        finding_count: 1,
        failed_count: 0,
        failures: [],
        started_at: '2026-09-27T10:00:00Z',
        finished_at: '2026-09-27T10:01:00Z',
      },
      { id: 'run-review', kind: 'review', matter_id: 'm1', prompt_version_id: 'v2', status: 'completed', failures: [] },
    ],
    workflow_findings: [
      { id: 'f1', run_id: 'run-audit', rule_number: '1', outcome: 'absent', severity: 'blocker', rationale: 'No trustee.', disposition: 'open' },
    ],
    workflow_field_references: [],
    design_sheets: [],
    workflow_run_steps: [{ run_id: 'run-audit', unit_id: '1', sequence: 0, status: 'succeeded', attempts: 1, finding_id: 'f1' }],
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

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const EMPTY = { ok: null, message: null, runId: null }

describe('runAudit', () => {
  it('queues the audit as the signed-in attorney', async () => {
    expect(await runAudit(EMPTY, form({ slug: 'ma-design-sheet-audit', matterId: 'm1' }))).toEqual({
      ok: true,
      message: null,
      runId: 'run-new',
    })
    expect(audit.runMatterAudit).toHaveBeenCalledWith(expect.anything(), {
      slug: 'ma-design-sheet-audit',
      matterId: 'm1',
      userId: 'staff-1',
    })
  })

  it('queues nothing for a caller who is not staff, a missing choice, or a missing model key', async () => {
    auth.staff = null
    expect(await runAudit(EMPTY, form({ slug: 'x', matterId: 'm1' }))).toMatchObject({ ok: false, message: 'You are not signed in as staff.' })
    auth.staff = 'staff-1'
    expect(await runAudit(EMPTY, form({ matterId: 'm1' }))).toMatchObject({ ok: false })
    expect(await runAudit(EMPTY, form({ slug: 'x' }))).toMatchObject({ ok: false })
    delete process.env.ANTHROPIC_API_KEY
    expect(await runAudit(EMPTY, form({ slug: 'x', matterId: 'm1' }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('ANTHROPIC_API_KEY'),
    })
    expect(audit.runMatterAudit).not.toHaveBeenCalled()
  })
})

describe('the field-audit run actions', () => {
  it('record a decision on a finding as the signed-in attorney, and reopen it', async () => {
    const client = seed()
    auth.client = asClient(client)
    expect(await recordFieldAuditDisposition(null, form({ findingId: 'f1', disposition: 'rejected', runId: 'run-audit' }))).toEqual({
      message: null,
    })
    expect(client.tableRows('workflow_findings')[0]).toMatchObject({ disposition: 'rejected', disposition_by: 'staff-1' })

    await recordFieldAuditDisposition(null, form({ findingId: 'f1', disposition: 'open', runId: 'run-audit' }))
    expect(client.tableRows('workflow_findings')[0]).toMatchObject({ disposition: 'open', disposition_by: null })
  })

  it('refuse a caller who is not staff and an unknown decision, writing nothing', async () => {
    const client = seed()
    auth.client = asClient(client)
    auth.staff = null
    expect(await recordFieldAuditDisposition(null, form({ findingId: 'f1', disposition: 'accepted' }))).toEqual({
      message: 'You are not signed in as staff.',
    })
    expect(await retryRun({ message: null }, form({ runId: 'run-audit' }))).toEqual({ message: 'You are not signed in as staff.' })
    auth.staff = 'staff-1'
    expect(await recordFieldAuditDisposition(null, form({ findingId: 'f1', disposition: 'approved' }))).toEqual({
      message: 'Unknown disposition.',
    })
    expect(client.tableRows('workflow_findings')[0].disposition).toBe('open')
  })

  it('refuse to requeue checks without a model key', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await retryRun({ message: null }, form({ runId: 'run-audit' }))).toEqual({
      message: expect.stringContaining('ANTHROPIC_API_KEY'),
    })
  })
})

describe('the field-audit pages', () => {
  it('send anyone who is not staff to login', async () => {
    auth.role = 'client'
    await expect(FieldAuditsPage()).rejects.toThrow('redirect:/auth/login')
    await expect(FieldAuditRunPage({ params: Promise.resolve({ runId: 'run-audit' }) })).rejects.toThrow('redirect:/auth/login')
  })

  it('offer field-audit prompts only, never a review playbook', async () => {
    const element = (await FieldAuditsPage()) as { props: { prompts: Array<{ slug: string; checkCount: number }> } }
    expect(element.props.prompts).toEqual([{ slug: 'ma-design-sheet-audit', title: 'Design sheet audit', checkCount: 1 }])
  })

  it('show a field-audit run, and 404 a review run', async () => {
    expect(await FieldAuditRunPage({ params: Promise.resolve({ runId: 'run-audit' }) })).toBeTruthy()
    await expect(FieldAuditRunPage({ params: Promise.resolve({ runId: 'run-review' }) })).rejects.toThrow('notFound')
  })
})

describe('GET /api/admin/matters/[id]/field-audits', () => {
  // The route takes a real matter id; the rest of this file's fixture uses 'm1'.
  const MATTER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const get = (id: string) => matterFieldAudits(new Request('http://localhost'), { params: Promise.resolve({ id }) })

  beforeEach(() => {
    const fixture = seed()
    for (const row of fixture.tableRows('matters')) row.id = MATTER
    for (const row of fixture.tableRows('workflow_runs')) row.matter_id = MATTER
    fixture.tableRows('matters').push({ id: OTHER, name: 'Jones Estate Plan' })
    fixture.tableRows('workflow_runs').push({
      id: 'run-other',
      kind: 'field_audit',
      matter_id: OTHER,
      prompt_version_id: 'v1',
      status: 'completed',
      finding_count: 0,
      failed_count: 0,
      failures: [],
      started_at: '2026-09-27T11:00:00Z',
    })
    auth.client = asClient(fixture)
  })

  it('offers field-audit prompts only, this matter\'s runs, and its open blocker', async () => {
    const response = await get(MATTER)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      prompts: Array<{ slug: string; checkCount: number }>
      hasDesignSheet: boolean
      runs: Array<{ runId: string }>
      unresolvedBlocker: { runId: string; ruleNumbers: string[] } | null
    }
    expect(body.prompts).toEqual([{ slug: 'ma-design-sheet-audit', title: 'Design sheet audit', checkCount: 1 }])
    expect(body.runs.map(run => run.runId)).toEqual(['run-audit'])
    expect(body.unresolvedBlocker).toMatchObject({ runId: 'run-audit', ruleNumbers: ['1'] })
    expect(body.hasDesignSheet).toBe(false)
  })

  it('says whether the matter has a design sheet to audit', async () => {
    ;(auth.client as unknown as ReturnType<typeof makeFakeClient>).tableRows('design_sheets').push({ matter_id: MATTER })
    const body = (await (await get(MATTER)).json()) as { hasDesignSheet: boolean }
    expect(body.hasDesignSheet).toBe(true)
  })

  it('refuses a malformed id and a caller who is not staff', async () => {
    expect((await get('m1')).status).toBe(400)
    auth.staff = null
    expect((await get(MATTER)).status).toBe(403)
  })
})
