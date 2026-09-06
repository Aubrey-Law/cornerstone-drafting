import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { runMatterAudit } from '@/lib/fieldAudit/run'
import { makeFakeClient } from './helpers/fakeSupabase'
import {
  FIELD_AUDIT_TOOL_NAME,
  actionableFindings,
  runFieldAudit,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditContext } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { ModelRequest, ModelResponse } from '@aubrey-law/citations/review/model'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

const VALUES = {
  trustee_name: 'Jane Doe',
  successor_trustee_name: 'Bob Jones',
  children: [{ name: 'Ada', dob: '2010-01-01' }],
}

const TASK_TEMPLATE = { title: 'Name a trustee', description: 'Add a trustee to the sheet.', priority: 'high' as const }

const TRUSTEE_CHECK: FieldAuditCheck = {
  number: '1',
  statement: 'A trustee is named.',
  risk: 'high',
  reads: ['trustee_name'],
  taskTemplate: TASK_TEMPLATE,
}

function bodyWithChecks(checks: FieldAuditCheck[]): FieldAuditBody {
  return {
    kind: 'field_audit',
    inputs: [
      { key: 'trustee_name', source: 'design_sheet.trustee_name', required: false },
      { key: 'successor_trustee_name', source: 'design_sheet.successor_trustee_name', required: false },
      { key: 'children', source: 'design_sheet.children', required: false },
    ],
    checks,
  }
}

const BODY = bodyWithChecks([TRUSTEE_CHECK])

const CONTEXT: FieldAuditContext = { promptSlug: 'test', promptVersion: 1, values: VALUES }

function respondWith(input: Record<string, unknown>): ModelResponse {
  return {
    content: [{ type: 'tool_use', name: FIELD_AUDIT_TOOL_NAME, id: 'x', input }],
  } as unknown as ModelResponse
}

describe('runFieldAudit', () => {
  it("keeps a finding whose reference verifies, with the check's severity", async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'The named trustee should be a corporate fiduciary.',
          references: [{ field_key: 'trustee_name', claimed_value: 'Jane Doe' }],
        }),
    })
    const [finding] = result.findings
    expect(finding.severity).toBe('high')
    expect(finding.references).toHaveLength(1)
    expect(finding.references[0].verification).toBe('verified')
  })

  it('keeps the finding but marks a wrong claim unverified, recording the real value', async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'Claimed the wrong trustee.',
          references: [{ field_key: 'trustee_name', claimed_value: 'John Smith' }],
        }),
    })
    const [finding] = result.findings
    expect(finding.outcome).toBe('deviation')
    expect(finding.references[0].verification).toBe('unverified')
    expect(finding.references[0].actualValue).toBe('Jane Doe')
  })

  it('reports a check whose call failed without losing the rest of the audit', async () => {
    const twoChecks = bodyWithChecks([
      TRUSTEE_CHECK,
      { ...TRUSTEE_CHECK, number: '2', statement: 'Second check.' },
    ])
    let calls = 0
    const result = await runFieldAudit(CONTEXT, twoChecks, {
      callModel: async () => {
        calls += 1
        if (calls === 1) throw new Error('overloaded')
        return respondWith({
          outcome: 'compliant',
          rationale: 'Fine.',
          references: [{ field_key: 'trustee_name', claimed_value: 'Jane Doe' }],
        })
      },
    })
    expect(result.failures).toEqual([{ checkNumber: '1', reason: 'overloaded' }])
    expect(result.findings.map(f => f.checkNumber)).toEqual(['2'])
  })

  it('reports an unrecognised outcome by naming it in the failure reason', async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'weird_outcome',
          rationale: 'Something odd.',
          references: [],
        }),
    })
    expect(result.failures).toEqual([{ checkNumber: '1', reason: 'Unrecognised outcome weird_outcome' }])
    expect(result.findings).toEqual([])
  })

  it('compliant carries null severity', async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'compliant',
          rationale: 'A trustee is named.',
          references: [{ field_key: 'trustee_name', claimed_value: 'Jane Doe' }],
        }),
    })
    expect(result.findings[0].severity).toBeNull()
  })

  it("sends the design sheet as a cached prefix, and keeps the varying check out of it", async () => {
    let captured: ModelRequest | null = null
    await runFieldAudit(CONTEXT, BODY, {
      callModel: async request => {
        captured = request
        return respondWith({ outcome: 'compliant', rationale: 'Fine.', references: [] })
      },
    })

    const system = captured!.system as Array<{ type: string; text: string; cache_control?: unknown }>
    expect(Array.isArray(system)).toBe(true)

    const cachedBlock = system.find(block => block.cache_control)
    expect(cachedBlock).toBeTruthy()
    expect(cachedBlock!.cache_control).toEqual({ type: 'ephemeral' })

    // The sheet is what's cached — it names the field the check reads...
    expect(cachedBlock!.text).toContain('trustee_name')
    // ...but not the check itself, which varies call to call and would
    // invalidate the whole point of caching a shared prefix.
    expect(cachedBlock!.text).not.toContain('Check 1')
    expect(cachedBlock!.text).not.toContain(TRUSTEE_CHECK.statement)

    // The check text lives in the user message instead.
    const userMessage = captured!.messages[0]
    expect(String(userMessage.content)).toContain('Check 1')
    expect(String(userMessage.content)).toContain(TRUSTEE_CHECK.statement)
  })
})

describe('actionableFindings', () => {
  it('includes a finding supported in part, and keeps the unverified reference with it', async () => {
    const bothTrusteesCheck: FieldAuditCheck = {
      number: '3',
      statement: 'Both trustees are identified.',
      risk: 'medium',
      reads: ['trustee_name', 'successor_trustee_name'],
      taskTemplate: TASK_TEMPLATE,
    }
    const result = await runFieldAudit(CONTEXT, bodyWithChecks([bothTrusteesCheck]), {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'One of the two is wrong.',
          references: [
            { field_key: 'trustee_name', claimed_value: 'Jane Doe' },
            { field_key: 'successor_trustee_name', claimed_value: 'Someone Else' },
          ],
        }),
    })
    // Three runs of the same checks against the same matter verified 19, 18
    // and 17 of 19 references — always drifting on the jsonb array fields. The
    // old rule dropped a blocker whose other references all checked out, and
    // the attorney never learned it was found. The unverified reference is
    // kept on the finding so what the task rests on stays visible.
    const actionable = actionableFindings(result)
    expect(actionable).toHaveLength(1)
    expect(actionable[0].references.filter((r) => r.verification === 'verified')).toHaveLength(1)
    expect(actionable[0].references.filter((r) => r.verification !== 'verified')).toHaveLength(1)
  })

  it('excludes a finding no reference supports at all', async () => {
    // The floor the gate still holds. Nothing was checked, so there is nothing
    // to act on — this is the case the verifier exists for, and loosening the
    // gate did not move it.
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'Asserted without support.',
          references: [{ field_key: 'trustee_name', claimed_value: 'Not what the field says' }],
        }),
    })
    expect(result.findings).toHaveLength(1)
    expect(actionableFindings(result)).toEqual([])
  })

  it('excludes a finding carrying no references whatsoever', async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({ outcome: 'deviation', rationale: 'Bare assertion.', references: [] }),
    })
    expect(actionableFindings(result)).toEqual([])
  })

  it('includes a deviation whose every reference verified', async () => {
    const result = await runFieldAudit(CONTEXT, BODY, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'Should be a corporate fiduciary.',
          references: [{ field_key: 'trustee_name', claimed_value: 'Jane Doe' }],
        }),
    })
    expect(actionableFindings(result)).toHaveLength(1)
  })
})

/**
 * `runMatterAudit` no longer runs the engine at all — it opens the run,
 * writes one `pending` step per check, and pokes the tick. A tick claims the
 * run and does the actual work later (`apps/workbench/app/api/cron/tick/route.ts`);
 * this only proves the run is left in the shape a tick can pick up.
 *
 * `makeFakeClient` stands in for Supabase: real enough to exercise
 * `loadPublishedPrompt`, `loadSourceRows`, `openRun` and `openSteps` end to
 * end, without a network.
 */
describe('runMatterAudit queues a run rather than running the engine', () => {
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
    checks: [AUDIT_CHECK, { ...AUDIT_CHECK, number: '2', statement: 'Second check.' }],
  }

  function seededClient() {
    return makeFakeClient({
      prompts: [{ id: 'p1', slug: 'audit-1', title: 'Audit One', kind: 'field_audit' }],
      prompt_publications: [{ prompt_id: 'p1', version_id: 'v1' }],
      prompt_versions: [{ id: 'v1', version_number: 1, body: AUDIT_BODY }],
      matters: [{ id: 'm1', name: 'Test matter' }],
      design_sheets: [{ matter_id: 'm1', version: 1, concerns: 'Some concern text' }],
    })
  }

  it('leaves a queued run with a pending step per check, and never calls the model', async () => {
    const client = seededClient()

    // `runMatterAudit`'s options no longer accept a model caller at all —
    // there is nothing left to hand it one to invoke. That absence, not a
    // call count, is the proof: the engine runs in the tick, never here.
    const result = await runMatterAudit(client as unknown as SupabaseClient<WorkbenchDatabase>, {
      slug: 'audit-1',
      matterId: 'm1',
      userId: 'u1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.queued).toBe(true)

    const runs = client.tableRows('workflow_runs')
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe(result.runId)
    // `queued`, not `running` and not `failed` — a tick has not claimed it
    // yet, so nothing has been attempted, let alone lost.
    expect(runs[0].status).toBe('queued')
    expect(runs[0].failed_count).toBe(0)
    expect(runs[0].finding_count).toBe(0)

    const steps = client.tableRows('workflow_run_steps')
    expect(steps).toHaveLength(2)
    // The steps belong to the run that was actually opened — not to nothing,
    // and not to some other id — which is only true because the run exists
    // before its steps do.
    expect(steps.every((step) => step.run_id === result.runId)).toBe(true)
    // The run's shape is known immediately: both checks are `pending`, in
    // the body's own order, with no attempt made yet.
    expect(steps.map((step) => step.unit_id)).toEqual(['1', '2'])
    expect(steps.map((step) => step.sequence)).toEqual([0, 1])
    expect(steps.every((step) => step.status === 'pending')).toBe(true)
    expect(steps.every((step) => step.attempts === 0)).toBe(true)
  })

  it('opens a run with no actor when the stage engine fired it', async () => {
    // A trigger-fired run has no user behind it. `created_by` is nullable for
    // exactly this case, and inventing an actor would put a person's name on
    // something they did not do.
    const client = seededClient()
    const result = await runMatterAudit(client as unknown as SupabaseClient<WorkbenchDatabase>, {
      slug: 'audit-1',
      matterId: 'm1',
      userId: null,
      poke: false,
    })
    expect(result.ok).toBe(true)
    const [run] = client.tableRows('workflow_runs') as Array<{ created_by: string | null }>
    expect(run.created_by).toBeNull()
  })

  it('pokes the tick by default, which is what the screen relies on', async () => {
    // Asserted first, because the next test asserts the absence of this and
    // an absence proves nothing unless the presence is proven too. With the
    // injection broken, `poke: false` would "pass" trivially.
    let poked = 0
    const client = seededClient()
    await runMatterAudit(client as unknown as SupabaseClient<WorkbenchDatabase>, {
      slug: 'audit-1',
      matterId: 'm1',
      userId: 'u1',
      pokeTick: async () => {
        poked += 1
      },
    })
    expect(poked).toBe(1)
  })

  it('does not poke when it is already inside a tick', async () => {
    // The tick materialises a trigger and then works it in the same
    // invocation. Poking from there would ask a second tick to start for work
    // this one is about to do.
    let poked = 0
    const client = seededClient()
    await runMatterAudit(client as unknown as SupabaseClient<WorkbenchDatabase>, {
      slug: 'audit-1',
      matterId: 'm1',
      userId: null,
      poke: false,
      pokeTick: async () => {
        poked += 1
      },
    })
    expect(poked).toBe(0)
  })
})
