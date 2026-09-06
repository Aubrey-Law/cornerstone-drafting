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
  it('excludes a finding where one reference verified and another did not', async () => {
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
 * `runMatterAudit`'s own three-phase restructure: the run row opens before
 * the engine starts, and each check's outcome is written as it settles — so
 * a run that loses every check to a dead model still leaves a `workflow_runs`
 * row and a `workflow_run_steps` row per check, instead of the old
 * "run the engine, insert everything at the end" leaving nothing at all.
 *
 * `makeFakeClient` stands in for Supabase: real enough to exercise
 * `loadPublishedPrompt`, `loadSourceRows`, `openRun`/`recordStep`/
 * `finaliseRun` and `saveFindings` end to end, without a network.
 */
describe('runMatterAudit records a run even when every check fails', () => {
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

  it('leaves a running-then-failed run and a failed step per check, not nothing at all', async () => {
    const client = seededClient()

    const result = await runMatterAudit(client as unknown as SupabaseClient<WorkbenchDatabase>, {
      slug: 'audit-1',
      matterId: 'm1',
      userId: 'u1',
      callModel: async () => {
        throw new Error('model down')
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.findingCount).toBe(0)

    const runs = client.tableRows('workflow_runs')
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe(result.runId)
    // Finalised to `failed`: every check was attempted and none produced a
    // finding — the honest word for a run that learned nothing, not
    // `completed`, which would say every check ran clean.
    expect(runs[0].status).toBe('failed')
    expect(runs[0].failed_count).toBe(2)
    expect(runs[0].finding_count).toBe(0)

    const steps = client.tableRows('workflow_run_steps')
    expect(steps).toHaveLength(2)
    // The steps belong to the run that was actually opened — not to nothing,
    // and not to some other id — which is only true because the run exists
    // before the engine starts.
    expect(steps.every((step) => step.run_id === result.runId)).toBe(true)
    expect(steps.map((step) => step.status)).toEqual(['failed', 'failed'])
    expect(steps.map((step) => step.last_error)).toEqual(['model down', 'model down'])
  })
})
