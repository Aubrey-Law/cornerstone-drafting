import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { retryFailedSteps } from '@/lib/runs/retry'
import { makeFakeClient } from './helpers/fakeSupabase'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { ReviewRule } from '@aubrey-law/citations/review/types'

/**
 * Retrying a run — proving the property the whole slice exists for.
 *
 * `retryFailedSteps` used to run the matching engine itself, over just the
 * failed units, in the same request. It no longer does: it marks the failed
 * units `pending` again and queues the run, and a tick does the actual work
 * — `tests/run-worker.test.ts` is where "the model is called only for
 * `pending` units" now lives, since that is a property of the worker, not of
 * retry. What belongs here is what retry itself is responsible for: which
 * steps it touches, and which it leaves alone.
 *
 * `stubClientWithRun` builds on `makeFakeClient` (`./helpers/fakeSupabase`)
 * rather than a second hand-rolled fake: it seeds a `field_audit` run, its
 * steps, and the prompt version it was checked against, then wraps two
 * chains so the test can see what retry actually did that a seeded table
 * can't show by itself — which prompt version id got read, and which
 * finding ids got deleted.
 */

const AUDIT_CHECKS: FieldAuditCheck[] = ['1', '2', '3'].map((number) => ({
  number,
  statement: `Check ${number}.`,
  risk: 'high',
  reads: ['concerns'],
  taskTemplate: { title: 'Task', description: 'Do the thing.', priority: 'high' },
}))

const AUDIT_BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: false }],
  checks: AUDIT_CHECKS,
}

interface StepSeed {
  unit_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  sequence: number
  attempts?: number
  finding_id?: string | null
}

interface StubConfig {
  steps: StepSeed[]
  resolved_inputs?: Record<string, unknown>
  prompt_version_id?: string
  findings?: Array<{ id: string; run_id: string; rule_number: string }>
  run_status?: string
}

/**
 * A field-audit run, seeded with its steps and its own pinned prompt
 * version — and, deliberately, a `design_sheets` row holding a *different*
 * value than `resolved_inputs`. Retry no longer replays anything against
 * either — `loadRunContext` is called only to confirm the run still
 * resolves — but the mismatch stays seeded so a regression that started
 * reading the live sheet again would still have something to leak.
 */
function stubClientWithRun(config: StubConfig) {
  const promptVersionId = config.prompt_version_id ?? 'v1'
  const base = makeFakeClient({
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'field_audit',
        status: config.run_status ?? 'partial',
        prompt_version_id: promptVersionId,
        matter_id: 'm1',
        resolved_inputs: config.resolved_inputs ?? { concerns: 'the original words' },
        text_layer_id: null,
        document_version_id: null,
        model: null,
      },
    ],
    workflow_run_steps: config.steps.map((step) => ({
      run_id: 'run-1',
      unit_id: step.unit_id,
      status: step.status,
      sequence: step.sequence,
      attempts: step.attempts ?? 1,
      finding_id: step.finding_id ?? null,
    })),
    workflow_findings: config.findings ?? [],
    prompts: [{ id: 'p1', slug: 'audit-1', title: 'Audit One', kind: 'field_audit' }],
    prompt_versions: [{ id: promptVersionId, version_number: 1, body: AUDIT_BODY, prompt_id: 'p1' }],
    matters: [{ id: 'm1', name: 'Test matter' }],
    design_sheets: [{ matter_id: 'm1', version: 1, concerns: 'edited since' }],
    tasks: [],
  })

  const deletedFindings: string[] = []
  const versionsRead: string[] = []

  return {
    tableRows: base.tableRows,
    deletedFindings,
    versionsRead,
    from(table: string) {
      const builder = base.from(table) as unknown as {
        eq: (column: string, value: unknown) => unknown
        delete: () => { eq: (column: string, value: unknown) => unknown }
      }
      if (table === 'prompt_versions') {
        const originalEq = builder.eq.bind(builder)
        builder.eq = (column: string, value: unknown) => {
          if (column === 'id') versionsRead.push(String(value))
          return originalEq(column, value)
        }
      }
      if (table === 'workflow_findings') {
        const originalDelete = builder.delete.bind(builder)
        builder.delete = () => {
          const del = originalDelete()
          const originalDelEq = del.eq.bind(del)
          del.eq = (column: string, value: unknown) => {
            if (column === 'id') deletedFindings.push(String(value))
            return originalDelEq(column, value)
          }
          return del
        }
      }
      return builder
    },
  }
}

function stepsOf(stub: ReturnType<typeof stubClientWithRun>) {
  return stub.tableRows('workflow_run_steps') as Array<{
    unit_id: string
    status: string
    attempts: number
    finding_id: string | null
  }>
}

function stepFor(stub: ReturnType<typeof stubClientWithRun>, unitId: string) {
  return stepsOf(stub).find((step) => step.unit_id === unitId)
}

describe('retrying a run', () => {
  it('marks only the failed units pending, leaving the successful ones untouched', async () => {
    // The whole point. A run that lost one check of three must requeue one
    // check, not three — and the two that succeeded must not be re-paid for.
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0, attempts: 1, finding_id: 'f1' },
        { unit_id: '2', status: 'failed', sequence: 1, attempts: 1 },
        { unit_id: '3', status: 'succeeded', sequence: 2, attempts: 1, finding_id: 'f3' },
      ],
      findings: [
        { id: 'f1', run_id: 'run-1', rule_number: '1' },
        { id: 'f3', run_id: 'run-1', rule_number: '3' },
      ],
    })

    const result = await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')

    expect(result).toEqual({ ok: true, retried: 1 })

    const retried = stepFor(stub, '2')
    expect(retried?.status).toBe('pending')
    expect(retried?.finding_id).toBeNull()

    // Untouched in every field that proves nothing was re-paid for: still
    // `succeeded`, still one attempt, still pointing at the finding it
    // always did.
    const unit1 = stepFor(stub, '1')
    expect(unit1?.status).toBe('succeeded')
    expect(unit1?.attempts).toBe(1)
    expect(unit1?.finding_id).toBe('f1')

    const unit3 = stepFor(stub, '3')
    expect(unit3?.status).toBe('succeeded')
    expect(unit3?.attempts).toBe(1)
    expect(unit3?.finding_id).toBe('f3')
  })

  it('sets the run back to queued, so a tick claims it', async () => {
    const stub = stubClientWithRun({
      run_status: 'partial',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    const runs = stub.tableRows('workflow_runs')
    expect(runs[0].status).toBe('queued')
  })

  it('uses the prompt version the run used, not whatever is published now', async () => {
    // A retry finishes the run it belongs to. Silently upgrading it to a
    // newer wording would make the run's findings answers to two questions.
    // `retryFailedSteps` still confirms this through `loadRunContext` before
    // touching anything, even though it no longer replays against the body.
    const stub = stubClientWithRun({
      prompt_version_id: 'v1',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.versionsRead).toEqual(['v1'])
  })

  it('does nothing when no step failed', async () => {
    const stub = stubClientWithRun({ steps: [{ unit_id: '1', status: 'succeeded', sequence: 0 }] })
    const result = await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(result).toEqual({ ok: true, retried: 0 })
    // Not even the run's own status was touched.
    expect(stub.tableRows('workflow_runs')[0].status).toBe('partial')
  })

  it('replaces the finding its earlier attempt left, and only that one', async () => {
    // workflow_findings has unique (run_id, rule_number), so a retried
    // unit's new finding — once the tick writes it — would collide with the
    // one its earlier attempt left. The old one is a superseded answer to
    // the same question from the same run — keeping both would make the
    // constraint a lie. Another unit's finding is untouched.
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0, finding_id: 'f1' },
        { unit_id: '2', status: 'failed', sequence: 1, finding_id: 'f2' },
      ],
      findings: [
        { id: 'f1', run_id: 'run-1', rule_number: '1' },
        { id: 'f2', run_id: 'run-1', rule_number: '2' },
      ],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.deletedFindings).toEqual(['f2'])
  })

  it('deletes nothing when the retried step never produced a finding', async () => {
    // The only step being retried here has finding_id: null — a genuine
    // null, not an absent field a lenient check would let slide by.
    const stub = stubClientWithRun({
      steps: [{ unit_id: '1', status: 'failed', sequence: 0, finding_id: null }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.deletedFindings).toEqual([])
  })

  /**
   * Task creation moved to the tick, entirely — see `lib/runs/retry.ts`'s
   * header comment. Before this, `retryFailedSteps` called `emitTasks`
   * itself once its (inline) engine call came back; now it has no findings
   * of its own to call it with, so nothing is ever written to `tasks` here,
   * for a field audit or otherwise.
   */
  it('creates no tasks itself — that is the tick’s job, once the requeued run finishes', async () => {
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0 },
        { unit_id: '2', status: 'failed', sequence: 1 },
      ],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.tableRows('tasks')).toEqual([])
  })
})

/**
 * The review half of retry — every test above exercises only the
 * field-audit branch's own data shape (`resolved_inputs`, no text layer).
 * `retryFailedSteps` no longer branches on `context.kind` at all — see the
 * header comment in `lib/runs/retry.ts` — so this exists to prove the same
 * "only the failed unit, nothing else touched" property holds for a review
 * run's steps too, not to re-prove anything already covered above.
 */

const REVIEW_RULES: ReviewRule[] = ['1', '2'].map((number) => ({
  number,
  statement: `Rule ${number}.`,
  risk: 'high',
}))

const REVIEW_BODY = {
  kind: 'review' as const,
  inputs: [],
  rules: REVIEW_RULES,
}

const STORED_LAYER_TEXT = 'The stored paragraph nobody re-extracted.'

interface ReviewStubConfig {
  steps: StepSeed[]
  prompt_version_id?: string
  run_status?: string
}

function stubReviewClient(config: ReviewStubConfig) {
  const promptVersionId = config.prompt_version_id ?? 'v1'
  const base = makeFakeClient({
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'review',
        status: config.run_status ?? 'partial',
        prompt_version_id: promptVersionId,
        matter_id: 'm1',
        resolved_inputs: null,
        text_layer_id: 'layer-1',
        document_version_id: 'docver-1',
        model: null,
      },
    ],
    workflow_run_steps: config.steps.map((step) => ({
      run_id: 'run-1',
      unit_id: step.unit_id,
      status: step.status,
      sequence: step.sequence,
      attempts: step.attempts ?? 1,
      finding_id: step.finding_id ?? null,
    })),
    workflow_findings: [],
    prompts: [{ id: 'p1', slug: 'review-1', title: 'Review One', kind: 'review' }],
    prompt_versions: [{ id: promptVersionId, version_number: 1, body: REVIEW_BODY, prompt_id: 'p1' }],
    matters: [{ id: 'm1', name: 'Test matter' }],
    document_text_layers: [
      {
        id: 'layer-1',
        source_kind: 'docx',
        status: 'ok',
        extractor: 'test',
        extractor_version: '1',
        source_sha256: 'a'.repeat(64),
        page_count: null,
        text: STORED_LAYER_TEXT,
        blocks: [
          { index: 0, charStart: 0, charEnd: STORED_LAYER_TEXT.length, text: STORED_LAYER_TEXT, page: null, bbox: null },
        ],
        spans: [],
      },
    ],
    tasks: [],
  })

  const versionsRead: string[] = []

  return {
    tableRows: base.tableRows,
    versionsRead,
    from(table: string) {
      const builder = base.from(table) as unknown as {
        eq: (column: string, value: unknown) => unknown
      }
      if (table === 'prompt_versions') {
        const originalEq = builder.eq.bind(builder)
        builder.eq = (column: string, value: unknown) => {
          if (column === 'id') versionsRead.push(String(value))
          return originalEq(column, value)
        }
      }
      return builder
    },
  }
}

describe('retrying a review run', () => {
  it('marks only the failed rule pending, leaving the succeeded one untouched', async () => {
    const stub = stubReviewClient({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0, attempts: 1 },
        { unit_id: '2', status: 'failed', sequence: 1, attempts: 1 },
      ],
    })
    const result = await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(result).toEqual({ ok: true, retried: 1 })

    const steps = stub.tableRows('workflow_run_steps') as Array<{ unit_id: string; status: string; attempts: number }>
    const unit1 = steps.find((s) => s.unit_id === '1')
    const unit2 = steps.find((s) => s.unit_id === '2')
    expect(unit2?.status).toBe('pending')
    expect(unit1?.status).toBe('succeeded')
    expect(unit1?.attempts).toBe(1)
  })

  it('uses the run’s own prompt_version_id, not the published one', async () => {
    const stub = stubReviewClient({
      prompt_version_id: 'v1',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.versionsRead).toEqual(['v1'])
  })

  it('sets the run back to queued', async () => {
    const stub = stubReviewClient({
      run_status: 'failed',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1')
    expect(stub.tableRows('workflow_runs')[0].status).toBe('queued')
  })
})
