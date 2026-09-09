import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { materialiseStageTrigger, settlementFor, settlementForThrown } from '@/lib/runs/triggers'
import { makeFakeClient } from './helpers/fakeSupabase'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

describe('what becomes of a claimed trigger', () => {
  it('is done, carrying its run, when a run opened', () => {
    expect(settlementFor({ ok: true, runId: 'run-1', queued: true })).toEqual({
      status: 'done',
      runId: 'run-1',
      lastError: null,
    })
  })

  it('is skipped, not failed, when the design sheet cannot answer the prompt', () => {
    // A matter reaching `drafting` with an empty `concerns` field is not a
    // run that failed. It is a run that should not have started, and
    // recording it as a failure would make `failed_count` mean something
    // else.
    expect(settlementFor({ ok: false, message: 'The design sheet is missing fields this audit needs…' })).toEqual({
      status: 'skipped',
      runId: null,
      lastError: 'The design sheet is missing fields this audit needs…',
    })
  })

  /**
   * A thrown error is a settlement too, and it used not to be.
   *
   * `runMatterAudit` returns `ok: false` for what it anticipates and throws
   * for what it does not — a query rejecting what it was handed, say. Nothing
   * caught those, so the exception left the tick and the trigger stayed
   * `claimed`: no run, no `last_error`, and `claim_prompt_stage_trigger`
   * selects only `pending`, so nothing would ever look at it again.
   */
  it('is skipped, carrying the message, when the audit threw', () => {
    expect(settlementForThrown(new Error('invalid input syntax for type uuid'))).toEqual({
      status: 'skipped',
      runId: null,
      lastError: 'invalid input syntax for type uuid',
    })
  })

  /** A thrown non-Error still has to produce a readable reason. */
  it('stringifies a thrown non-Error rather than recording nothing', () => {
    expect(settlementForThrown('boom')).toEqual({ status: 'skipped', runId: null, lastError: 'boom' })
  })

  it('is skipped when the matter has no design sheet at all', () => {
    expect(settlementFor({ ok: false, message: 'That matter has no design sheet yet…' }).status).toBe('skipped')
  })
})

/**
 * `materialiseStageTrigger` against a fake client: `makeFakeClient`'s
 * `.rpc()` stands in for `claim_prompt_stage_trigger`, and its tables stand
 * in for everything `runMatterAudit` reads and writes — the same fixture
 * shape `tests/field-audit-run.test.ts` builds for the same function.
 */
const AUDIT_CHECK: FieldAuditCheck = {
  number: '1',
  statement: 'A trustee is named.',
  risk: 'high',
  reads: ['concerns'],
  taskTemplate: { title: 'Name a trustee', description: 'Add a trustee to the sheet.', priority: 'high' },
}
const AUDIT_BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: false }],
  checks: [AUDIT_CHECK],
  outputTarget: 'task_set',
}

const ALL_NULL_TRIGGER_ROW = {
  id: null,
  matter_id: null,
  prompt_id: null,
  to_stage: null,
  stage_entered_at: null,
  status: null,
  run_id: null,
  last_error: null,
  claimed_at: null,
  settled_at: null,
  created_at: null,
}

function claimedTriggerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1',
    matter_id: 'm1',
    prompt_id: 'p1',
    to_stage: 'drafting',
    stage_entered_at: '2026-09-06T00:00:00.000Z',
    status: 'claimed',
    run_id: null,
    last_error: null,
    claimed_at: '2026-09-06T00:00:01.000Z',
    settled_at: null,
    created_at: '2026-09-05T00:00:00.000Z',
    ...overrides,
  }
}

function seededClient(
  rpcHandlers: Record<string, () => { data: unknown; error: null }>,
  overrides: Partial<Record<string, Array<Record<string, unknown>>>> = {},
) {
  return makeFakeClient(
    {
      prompts: [{ id: 'p1', slug: 'audit-1', title: 'Audit One', kind: 'field_audit' }],
      prompt_publications: [{ prompt_id: 'p1', version_id: 'v1' }],
      prompt_versions: [{ id: 'v1', version_number: 1, body: AUDIT_BODY }],
      matters: [{ id: 'm1', name: 'Test matter with a sheet' }, { id: 'm2', name: 'Test matter with no sheet' }],
      design_sheets: [{ matter_id: 'm1', version: 1, concerns: 'Some concern text' }],
      prompt_stage_triggers: [claimedTriggerRow()],
      ...overrides,
    },
    rpcHandlers,
  )
}

describe('materialiseStageTrigger', () => {
  it('reports nothing claimed when the RPC returns a row of all-null columns, rather than reading a prompt for a null id', async () => {
    const client = seededClient({
      claim_prompt_stage_trigger: () => ({ data: ALL_NULL_TRIGGER_ROW, error: null }),
    })

    const result = await materialiseStageTrigger(client as unknown as SupabaseClient<WorkbenchDatabase>, 'worker-1')

    expect(result).toEqual({ claimed: false, runId: null, status: null })
    // Nothing else happened: no run was opened, and the (unrelated) seeded
    // trigger row was left untouched.
    expect(client.tableRows('workflow_runs')).toEqual([])
  })

  it('materialises a claimed trigger into a queued run, and settles the trigger done', async () => {
    const client = seededClient({
      claim_prompt_stage_trigger: () => ({ data: claimedTriggerRow(), error: null }),
    })

    const result = await materialiseStageTrigger(client as unknown as SupabaseClient<WorkbenchDatabase>, 'worker-1')

    expect(result.claimed).toBe(true)
    expect(result.status).toBe('done')
    expect(result.runId).not.toBeNull()

    const runs = client.tableRows('workflow_runs')
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe(result.runId)
    expect(runs[0].created_by).toBeNull()

    const [trigger] = client.tableRows('prompt_stage_triggers')
    expect(trigger.status).toBe('done')
    expect(trigger.run_id).toBe(result.runId)
    expect(trigger.last_error).toBeNull()
  })

  it('settles the trigger skipped, with the reason, and creates no run when the audit could not start', async () => {
    const client = seededClient({
      claim_prompt_stage_trigger: () => ({ data: claimedTriggerRow({ matter_id: 'm2' }), error: null }),
    })

    const result = await materialiseStageTrigger(client as unknown as SupabaseClient<WorkbenchDatabase>, 'worker-1')

    expect(result.claimed).toBe(true)
    expect(result.status).toBe('skipped')
    expect(result.runId).toBeNull()

    expect(client.tableRows('workflow_runs')).toEqual([])

    const [trigger] = client.tableRows('prompt_stage_triggers')
    expect(trigger.status).toBe('skipped')
    expect(trigger.run_id).toBeNull()
    expect(trigger.last_error).toMatch(/design sheet/)
  })

  /**
   * The measured failure, as a test.
   *
   * On 2026-09-09 six triggers were queued across six matters. The tick
   * claimed one a minute exactly on schedule and settled four; two threw and
   * were left `claimed` with no run and no error, and the only reason anybody
   * noticed is that six triggers produced four results. Both were the same
   * cause: a design sheet whose slot `contact_id` holds the sentinel
   * `__design_sheet_client__` instead of a uuid, which Postgres rejects when
   * it reaches a uuid column. Seven of forty-four sheets carry such a value.
   *
   * The exception must not leave this function. It must land in `last_error`
   * on the row, which is where someone asking why a matter was never audited
   * will look.
   */
  it('settles the trigger instead of letting a thrown error strand the claim', async () => {
    const client = seededClient(
      { claim_prompt_stage_trigger: () => ({ data: claimedTriggerRow(), error: null }) },
      {
        // A sheet carrying the sentinel, which is what makes `loadSourceRows`
        // read `contacts` at all — with no slot populated it never queries and
        // never throws, so the fixture has to be the real shape.
        design_sheets: [
          {
            matter_id: 'm1',
            version: 1,
            concerns: 'Some concern text',
            trustee_slots: [{ order: 1, is_co: false, contact_id: '__design_sheet_client__' }],
          },
        ],
      },
    )
    // Postgres rejects that sentinel when it reaches a uuid column.
    client.failTable('contacts', 'invalid input syntax for type uuid: "__design_sheet_client__"')

    const result = await materialiseStageTrigger(client as unknown as SupabaseClient<WorkbenchDatabase>, 'worker-1')

    expect(result.claimed).toBe(true)
    expect(result.status).toBe('skipped')
    expect(result.runId).toBeNull()
    expect(client.tableRows('workflow_runs')).toEqual([])

    const [trigger] = client.tableRows('prompt_stage_triggers')
    expect(trigger.status).toBe('skipped')
    expect(trigger.last_error).toMatch(/invalid input syntax for type uuid/)
    // Not left claimed, which is the whole point.
    expect(trigger.status).not.toBe('claimed')
  })
})
