import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  FIELD_AUDIT_TOOL_NAME,
  fieldAuditRender,
  type FieldAuditRender,
} from '@aubrey-law/citations/fieldAudit/render'
import { runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

/** Two reads, so `checkMessage`'s join of the list is actually exercised. */
const CHECK: FieldAuditCheck = {
  number: '4',
  statement: 'Every minor child has a nominated guardian.',
  risk: 'blocker',
  reads: ['children', 'guardian_nominations'],
  taskTemplate: {
    title: 'Nominate a guardian',
    description: 'The sheet names minor children and no guardian.',
    priority: 'high',
  },
}

describe('the field-audit render registry', () => {
  it('resolves the current version to a complete entry', () => {
    const render = fieldAuditRender(CURRENT_FIELD_AUDIT_RENDER_VERSION)
    expect(render.instructions.trim().length).toBeGreaterThan(0)
    expect(render.tool.name.length).toBeGreaterThan(0)
    expect(render.tool.input_schema).toBeTruthy()
    expect(render.maxTokens).toBeGreaterThan(0)
  })

  /** A bumped CURRENT_ with no entry would render `undefined` as the system
   *  prompt, and the model would answer anyway. */
  it('has no half-built entry', () => {
    // The loop below visits only the entries that exist, so this line is the
    // half that earns the comment above it.
    expect(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION]).toBeTruthy()

    for (const [version, render] of Object.entries(FIELD_AUDIT_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      // Called, not type-checked: that these three *are* functions is already
      // guaranteed by the interface, so asserting it proves nothing. What the
      // type cannot say is that they return anything.
      expect(render.checkMessage(CHECK).length, `v${version} checkMessage`).toBeGreaterThan(0)
      expect(render.sheet({}).length, `v${version} sheet`).toBeGreaterThan(0)
      expect(render.parse({}).claims, `v${version} parse`).toEqual([])
    }
  })

  it('falls back to current for a run made before versioning', () => {
    expect(fieldAuditRender(null)).toBe(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION])
    expect(fieldAuditRender(undefined)).toBe(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION])
  })

  /**
   * A hard error, not a fallback. A run pinning a version this build has lost
   * is a run nobody can honestly finish, and substituting a different render
   * would answer a different question while the run still reports its own
   * version.
   */
  it('refuses a version it does not have, rather than substituting one', () => {
    expect(() => fieldAuditRender(99)).toThrow(/version 99/)
  })
})

/**
 * A second check, distinct from `CHECK` above: the routing cases below assert
 * on the wording of a rendered message ("V2 check 1"), so the check number
 * has to be the one that wording names.
 */
const RUN_CHECK: FieldAuditCheck = {
  number: '1',
  statement: 'Every concern has a provision.',
  risk: 'blocker',
  reads: ['concerns'],
  taskTemplate: {
    title: 'A concern is unanswered',
    description: 'Confirm it.',
    priority: 'high',
  },
}
const BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
  checks: [RUN_CHECK],
  outputTarget: 'task_set',
}

/**
 * A second version that differs in every way the registry is supposed to
 * carry: a renamed tool, a renamed reference field, and different wrapper
 * text. Without it, "the engine uses the run's version" is unfalsifiable —
 * one entry means the pinned entry and the current entry are the same object.
 *
 * Injected by assigning into the exported record and deleting the key
 * afterwards, so no production signature is bent to accept a test double.
 */
const V2: FieldAuditRender = {
  instructions: 'Version two instructions.',
  tool: {
    name: 'report_check_v2',
    description: 'Version two.',
    input_schema: {
      type: 'object' as const,
      properties: {
        outcome: { type: 'string', enum: ['compliant', 'deviation', 'absent', 'not_applicable'] },
        rationale: { type: 'string' },
        refs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, value: { type: ['string', 'null'] } },
            required: ['field', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['outcome', 'rationale', 'refs'],
      additionalProperties: false,
    },
  },
  maxTokens: 77,
  checkMessage: check => `V2 check ${check.number}`,
  sheet: () => 'V2 sheet',
  parse: input => ({
    outcome: input.outcome,
    rationale: typeof input.rationale === 'string' ? input.rationale : null,
    claims: (Array.isArray(input.refs) ? input.refs : [])
      .filter((ref): ref is Record<string, unknown> => ref !== null && typeof ref === 'object')
      .map(ref => ({
        fieldKey: typeof ref.field === 'string' ? ref.field : '',
        claimedValue: typeof ref.value === 'string' ? ref.value : null,
      }))
      .filter(claim => claim.fieldKey !== ''),
  }),
}

beforeAll(() => {
  FIELD_AUDIT_RENDERS[2] = V2
})
afterAll(() => {
  delete FIELD_AUDIT_RENDERS[2]
})

/** Captures the request the engine built, and answers with `input`. */
function captor(input: Record<string, unknown>) {
  const requests: Array<Record<string, unknown>> = []
  const callModel = async (request: unknown) => {
    const typed = request as Record<string, unknown>
    requests.push(typed)
    const toolName = (typed.tools as Array<{ name: string }>)[0].name
    return { content: [{ type: 'tool_use', id: 'tu_1', name: toolName, input }] } as never
  }
  return { requests, callModel }
}

describe('the engine renders the version the run pinned', () => {
  it('sends version 1 wholesale for a run pinning 1', async () => {
    const { requests, callModel } = captor({
      outcome: 'compliant',
      rationale: 'Fine.',
      references: [],
    })
    await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 1 },
      BODY,
      { callModel },
    )
    const request = requests[0]
    expect(request.max_tokens).toBe(1024)
    expect((request.tools as Array<{ name: string }>)[0].name).toBe('report_check')
    expect((request.system as Array<{ text: string }>)[0].text).toBe(FIELD_AUDIT_RENDERS[1].instructions)
    expect((request.tool_choice as { name: string }).name).toBe('report_check')
  })

  it('sends version 2 wholesale for a run pinning 2', async () => {
    const { requests, callModel } = captor({ outcome: 'compliant', rationale: 'Fine.', refs: [] })
    await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 2 },
      BODY,
      { callModel },
    )
    const request = requests[0]
    expect(request.max_tokens).toBe(77)
    expect((request.tools as Array<{ name: string }>)[0].name).toBe('report_check_v2')
    expect((request.system as Array<{ text: string }>)[0].text).toBe('Version two instructions.')
    expect((request.system as Array<{ text: string }>)[1].text).toBe('V2 sheet')
    expect((request.messages as Array<{ content: string }>)[0].content).toBe('V2 check 1')
  })

  /**
   * The parse routes too, and this is the assertion that a single-version
   * registry could never make: the same answer shape verifies under the
   * version that declares it and produces nothing under the version that
   * does not.
   */
  it('parses with the pinned version, not the current one', async () => {
    const v2Answer = { outcome: 'deviation', rationale: 'Missing.', refs: [{ field: 'concerns', value: 'x' }] }

    const underTwo = await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 2 },
      BODY,
      { callModel: captor(v2Answer).callModel },
    )
    expect(underTwo.findings[0].references).toHaveLength(1)
    expect(underTwo.findings[0].references[0].verification).toBe('verified')

    // Version 1's parser reads `references`, which this answer does not have,
    // so it finds no claims — and an unsupported deviation fails its unit.
    const underOne = await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 1 },
      BODY,
      { callModel: captor(v2Answer).callModel },
    )
    expect(underOne.findings).toHaveLength(0)
    expect(underOne.failures[0].reason).toMatch(/no field references/)
  })

  /**
   * The gate is not versioned, deliberately. A run's question must not change
   * after it opens; its conclusion is allowed to improve. So #422's refusal of
   * an unsupported finding applies to a v2 answer exactly as to a v1 one.
   */
  it('applies the current gate whatever version the run pinned', async () => {
    const { requests, callModel } = captor({ outcome: 'deviation', rationale: 'Missing.', refs: [] })
    const result = await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 2 },
      BODY,
      { callModel },
    )
    // Version 1's parser also finds no claims in a `refs` answer, so the
    // refusal below fires under either render — which would make this case
    // pass even if the engine ignored the pinned version entirely. This line
    // is what makes it say what it means: the gate refused an answer to a
    // question that was actually asked as version 2.
    expect(requests[0].max_tokens).toBe(77)
    expect(result.findings).toHaveLength(0)
    expect(result.failures[0].reason).toMatch(/reported "deviation" with no field references/)
  })

  /** And it fails before spending a model call, not partway through a batch. */
  it('throws before calling the model when the version is unknown', async () => {
    let called = false
    await expect(
      runFieldAudit(
        { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 42 },
        BODY,
        {
          callModel: async () => {
            called = true
            return { content: [] } as never
          },
        },
      ),
    ).rejects.toThrow(/version 42/)
    expect(called).toBe(false)
  })

  /**
   * A bump that renames the tool and forgets this export would leave every
   * test building mock responses under a name nothing matches.
   */
  it('exports the current render tool name', () => {
    expect(FIELD_AUDIT_TOOL_NAME).toBe(
      FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION].tool.name,
    )
  })
})
