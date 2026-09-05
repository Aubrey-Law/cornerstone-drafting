import { describe, expect, it } from 'vitest'
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
