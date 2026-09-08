import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  fieldAuditRender,
  type FieldAuditRender,
} from '@aubrey-law/citations/fieldAudit/render'
// The tool name deliberately comes from the *engine*, not from `render`, which
// is where it is defined. See the case that asserts on it below.
import {
  FIELD_AUDIT_TOOL_NAME,
  runFieldAudit,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import {
  CURRENT_REVIEW_RENDER_VERSION,
  REVIEW_RENDERS,
  reviewRender,
  type ReviewRender,
} from '@aubrey-law/citations/review/render'
// As above: from the engine, not from `render`.
import { REVIEW_TOOL_NAME, runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ReviewRule } from '@aubrey-law/citations/review/types'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

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

  /**
   * The consequence of a bumped `CURRENT_` with no entry is a `TypeError`, not
   * a rendered `undefined`. `fieldAuditRender(null)` — the path every run made
   * before versioning takes — returns
   * `FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION]`, which is
   * `undefined`, and the next line, `render.sheet(context.values)` in
   * `runFieldAudit`, throws on reading a property of `undefined` before any
   * request is built. So no model is asked anything and the failure is loud;
   * what it is not is diagnosable, because nothing in the stack names the
   * missing version. (A run pinning the bumped *number* gets the registry's
   * own error, which does name it — the two paths fail differently, and only
   * one of them says why.) The line below catches the whole class at the
   * commit that bumps the constant, rather than at some later run's tick.
   */
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
      // The registry invites a later entry to reuse v1's pieces for whatever
      // has not changed, and a renamed tool is the one case where that is a
      // trap: `checkMessageV1` interpolates its own `TOOL_NAME_V1` into the
      // sentence telling the model which tool to call, so an entry with a new
      // `tool` and `checkMessage: checkMessageV1` would name the old tool in
      // the message while `tools` and `tool_choice` carry the new one. The
      // model would most likely answer against the schema regardless, which
      // makes it the worst kind of defect — one that never surfaces.
      expect(render.checkMessage(CHECK), `v${version} names its own tool`).toContain(
        render.tool.name,
      )
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
/**
 * Absurd on purpose: the fixture is keyed where no real registry entry will
 * ever be, so adding a genuine version 2 cannot silently overwrite it — nor
 * be overwritten by it. If a real 9001 ever exists, the `beforeAll` guard
 * below says so out loud instead.
 *
 * It is injected inside the engine block below rather than at file level, so
 * the registry sweep above iterates real entries only. A green sweep should
 * say something about the registry; a fixture written to satisfy it says
 * nothing — and the tool-name guard added to that sweep would have gone red on
 * this double's `checkMessage`, which names no tool, rather than on any entry
 * a run can pin.
 */
const SYNTHETIC_FIELD_AUDIT_VERSION = 9001

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

/**
 * A third entry, keyed out of production's reach exactly as the fixture above
 * is, and differing from it in the one respect this case needs: its `parse`
 * *keeps* a claim that names no field.
 *
 * `parseV1` filters those out, and so does the fixture above, so every other
 * case here would still pass with `runFieldAudit`'s own empty-`fieldKey`
 * filter deleted — the parser would be silently carrying a gate the gate is
 * supposed to hold. This entry withdraws that cover, which is what makes the
 * engine's filter independently load-bearing.
 */
const LEAKY_PARSE_VERSION = 9002

const LEAKY_PARSE: FieldAuditRender = {
  instructions: 'Leaky-parse instructions.',
  tool: {
    name: 'report_check_leaky',
    description: 'Reports a check, and keeps a claim that names no field.',
    input_schema: {
      type: 'object' as const,
      properties: {
        outcome: { type: 'string', enum: ['compliant', 'deviation', 'absent', 'not_applicable'] },
        rationale: { type: 'string' },
      },
      required: ['outcome', 'rationale'],
      additionalProperties: false,
    },
  },
  maxTokens: 88,
  checkMessage: check =>
    `Check ${check.number}. Report your conclusion using the report_check_leaky tool.`,
  sheet: () => 'Leaky-parse sheet',
  /**
   * A deviation supported by one claim naming nothing — the shape a future
   * parser produces by dropping `parseV1`'s trailing
   * `.filter(claim => claim.fieldKey !== '')`. Only for a `deviation`, so
   * `parse({})` still returns no claims and this entry would satisfy the
   * registry sweep if it were ever visible to it.
   */
  parse: input => ({
    outcome: input.outcome,
    rationale: typeof input.rationale === 'string' ? input.rationale : null,
    claims: input.outcome === 'deviation' ? [{ fieldKey: '', claimedValue: null }] : [],
  }),
}

/**
 * Captures the request the engine built, and answers with `input` under
 * whatever tool name that request actually asked for. Shared by both halves:
 * `runFieldAudit` takes its `ModelCaller` from `../review/model`, so one
 * function serves both engines and a second copy could only drift from it.
 *
 * Echoing the request's own tool name is deliberate: a mock hard-coded to a
 * fixture's tool name would fail a broken engine merely because
 * `readToolInput` matched nothing, which proves the name was sent and nothing
 * about the rest of the entry. Answering whatever was asked forces the
 * assertions below to carry the weight.
 */
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
  beforeAll(() => {
    expect(
      FIELD_AUDIT_RENDERS[SYNTHETIC_FIELD_AUDIT_VERSION],
      're-key this fixture',
    ).toBeUndefined()
    expect(FIELD_AUDIT_RENDERS[LEAKY_PARSE_VERSION], 're-key this fixture').toBeUndefined()
    FIELD_AUDIT_RENDERS[SYNTHETIC_FIELD_AUDIT_VERSION] = V2
    FIELD_AUDIT_RENDERS[LEAKY_PARSE_VERSION] = LEAKY_PARSE
  })
  afterAll(() => {
    delete FIELD_AUDIT_RENDERS[SYNTHETIC_FIELD_AUDIT_VERSION]
    delete FIELD_AUDIT_RENDERS[LEAKY_PARSE_VERSION]
  })

  // A regression guard on version 1's values, and no more: pinning 1 and
  // pinning nothing resolve the identical object, because 1 *is* the current
  // version — so nothing here can prove the engine reads the run's version
  // rather than the current one. The routing claim is carried by the cases
  // below, which pin a version the current one is not.
  it("renders version 1's values", async () => {
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
      {
        promptSlug: 's',
        promptVersion: 1,
        values: { concerns: 'x' },
        renderVersion: SYNTHETIC_FIELD_AUDIT_VERSION,
      },
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
      {
        promptSlug: 's',
        promptVersion: 1,
        values: { concerns: 'x' },
        renderVersion: SYNTHETIC_FIELD_AUDIT_VERSION,
      },
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
      {
        promptSlug: 's',
        promptVersion: 1,
        values: { concerns: 'x' },
        renderVersion: SYNTHETIC_FIELD_AUDIT_VERSION,
      },
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

  /**
   * And the engine's own empty-`fieldKey` filter holds the gate up, not the
   * pinned version's parser.
   *
   * Every case above passes with that filter deleted, because `parseV1` and
   * the v2 fixture both drop an empty claim themselves — so the filter was
   * dead code with no guard, which is the failure mode this slice keeps
   * finding. `LEAKY_PARSE` keeps the claim, so the two behaviours separate:
   * with the filter the gate counts nothing offered and refuses the deviation;
   * without it the claim becomes one unverified reference (`reads` does not
   * include `''`, so `verifyFieldReference` returns `unverified` rather than
   * throwing), `references.length === 1`, and a deviation resting on no field
   * at all comes back as a finding.
   */
  it('refuses an unsupported deviation when the pinned parser keeps an empty claim', async () => {
    const { requests, callModel } = captor({ outcome: 'deviation', rationale: 'Missing.' })
    const result = await runFieldAudit(
      {
        promptSlug: 's',
        promptVersion: 1,
        values: { concerns: 'x' },
        renderVersion: LEAKY_PARSE_VERSION,
      },
      BODY,
      { callModel },
    )
    // As on the case above: the question really was asked as this version, not
    // merely parsed by it.
    expect(requests[0].max_tokens).toBe(88)
    expect(result.findings).toHaveLength(0)
    expect(result.failures[0].reason).toMatch(/no field references/)
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
   * Imported from the engine, not from `render` — which is the whole point.
   * `render.ts` *defines* `FIELD_AUDIT_TOOL_NAME` as
   * `FIELD_AUDIT_RENDERS[CURRENT_…].tool.name`, so comparing the two through
   * that module would be an expression against itself and could not go red.
   * What is actually at risk is the re-export: `field-audit-run.test.ts` and
   * `run-worker.test.ts` build their mock tool_use blocks from the engine's
   * copy of the name, so a re-export that goes missing or is re-declared as a
   * literal has to fail here rather than at the API, where a renamed tool
   * reads nothing from every unit and fails the whole run for a reason that
   * looks like a model problem.
   */
  it('exports the current render tool name', () => {
    expect(FIELD_AUDIT_TOOL_NAME).toBe(
      FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION].tool.name,
    )
  })
})

/**
 * One block, so the ¶ hint the document formatter prints is a real block
 * index the verifier can scope by. Built to `TextLayer` in
 * `packages/citations/src/textLayer/types.ts` — `charStart`/`charEnd` index
 * into `text`, and `blocks[0].index` is `0`, which is why the answers below
 * hint block `0`.
 */
const LAYER_TEXT = 'The trustee shall distribute income annually.'
const LAYER: TextLayer = {
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'test',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: LAYER_TEXT,
  blocks: [
    { index: 0, charStart: 0, charEnd: LAYER_TEXT.length, text: LAYER_TEXT, page: null, bbox: null },
  ],
  spans: [],
}

/**
 * `preferredLanguage` is `.optional()` on `reviewRuleSchema`, so it is
 * `string | undefined` — set here rather than omitted, so `ruleMessage`'s
 * preferred-language branch is actually rendered by the entry sweep below.
 */
const REVIEW_RULE: ReviewRule = {
  number: '7',
  statement: 'The indemnity is mutual.',
  risk: 'high',
  preferredLanguage: 'Each party indemnifies the other.',
}

describe('the review render registry', () => {
  it('resolves the current version to a complete entry', () => {
    const render = reviewRender(CURRENT_REVIEW_RENDER_VERSION)
    expect(render.instructions.trim().length).toBeGreaterThan(0)
    expect(render.tool.name.length).toBeGreaterThan(0)
    expect(render.tool.input_schema).toBeTruthy()
    expect(render.maxTokens).toBeGreaterThan(0)
  })

  /**
   * The consequence of a bumped `CURRENT_` with no entry is a `TypeError`, not
   * a rendered `undefined` — the field-audit case's reasoning, unchanged.
   * `reviewRender(null)` returns
   * `REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION]`, which is `undefined`, and
   * the next line, `render.document(layer)` in `runReviewPlaybook`, throws on
   * reading a property of `undefined` before any request is built. Loud, but
   * naming nothing: no part of that stack says which version is missing. (A
   * run pinning the bumped *number* gets the registry's own error, which
   * does.) The line below catches the whole class at the commit that bumps the
   * constant.
   */
  it('has no half-built entry', () => {
    // The loop below visits only the entries that exist, so this line is the
    // half that earns the comment above it.
    expect(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION]).toBeTruthy()

    for (const [version, render] of Object.entries(REVIEW_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      // Called, not type-checked: that these three *are* functions is already
      // guaranteed by the interface, so asserting it proves nothing. What the
      // type cannot say is that they return anything.
      expect(render.ruleMessage(REVIEW_RULE).length, `v${version} ruleMessage`).toBeGreaterThan(0)
      expect(render.document(LAYER).length, `v${version} document`).toBeGreaterThan(0)
      expect(render.parse({}).quote, `v${version} parse`).toBeNull()
      // The field-audit sweep's reasoning, unchanged: `ruleMessageV1`
      // interpolates its own `TOOL_NAME_V1` into the sentence telling the
      // model which tool to call, so an entry with a new `tool` that reuses
      // `ruleMessage: ruleMessageV1` would name the old tool in the message
      // while `tools` and `tool_choice` carry the new one — and the model
      // would most likely comply with the schema anyway, so nothing else
      // would go red.
      expect(render.ruleMessage(REVIEW_RULE), `v${version} names its own tool`).toContain(
        render.tool.name,
      )
    }
  })

  it('falls back to current for a run made before versioning', () => {
    expect(reviewRender(null)).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION])
    expect(reviewRender(undefined)).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION])
  })

  /**
   * A hard error, not a fallback — the field-audit registry's reasoning,
   * unchanged: substituting a different render would answer a different
   * question while the run still reports its own version.
   */
  it('refuses a version it does not have, rather than substituting one', () => {
    expect(() => reviewRender(99)).toThrow(/version 99/)
  })

  /**
   * Imported from the engine, not from `render`, for the reason spelled out on
   * the field-audit case above: `render.ts` derives `REVIEW_TOOL_NAME` from
   * this very expression, so the comparison only says something when it
   * crosses the re-export. The root app's `tests/review-slice.test.ts` reaches
   * the name through `lib/reviewSlice/runReview`'s `export *` of this engine,
   * so a re-export that goes missing or is re-declared as a literal fails
   * here rather than at the API.
   */
  it('exports the current render tool name', () => {
    expect(REVIEW_TOOL_NAME).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION].tool.name)
  })
})

/**
 * A second rule, distinct from `REVIEW_RULE` above: the routing cases below
 * assert on the wording of a rendered message ("V2 rule 1"), so the rule
 * number has to be the one that wording names. `preferredLanguage` is
 * `.optional()` on `reviewRuleSchema`, so it is omitted here, not null.
 */
const RUN_RULE: ReviewRule = {
  number: '1',
  statement: 'Income distribution is stated.',
  risk: 'high',
}
const PLAYBOOK = { slug: 'p', title: 'P', version: 1, rules: [RUN_RULE] }

/**
 * A second review version that differs in every way the registry is supposed
 * to carry: a renamed tool, renamed quote fields, and different wrapper text.
 * Without it, "the engine uses the run's version" is unfalsifiable — one entry
 * means the pinned entry and the current entry are the same object.
 *
 * Injected by assigning into the exported record and deleting the key
 * afterwards, so no production signature is bent to accept a test double.
 */
/** Absurd on purpose, for the reason given on `SYNTHETIC_FIELD_AUDIT_VERSION`:
 *  it must never collide with a real registry entry. */
const SYNTHETIC_REVIEW_VERSION = 9001

const REVIEW_V2: ReviewRender = {
  instructions: 'Review version two.',
  tool: {
    name: 'report_finding_v2',
    description: 'Version two.',
    input_schema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['compliant', 'deviation', 'absent', 'not_applicable'] },
        q: { type: ['string', 'null'] },
        b: { type: ['integer', 'null'] },
      },
      required: ['outcome', 'q', 'b'],
      additionalProperties: false,
    },
  },
  maxTokens: 55,
  ruleMessage: rule => `V2 rule ${rule.number}`,
  document: () => 'V2 document',
  parse: input => ({
    outcome: input.outcome,
    rationale: null,
    quote: typeof input.q === 'string' ? input.q : null,
    blockIndex: typeof input.b === 'number' ? input.b : null,
    proposedLanguage: null,
  }),
}

describe('the review engine renders the version the run pinned', () => {
  beforeAll(() => {
    expect(REVIEW_RENDERS[SYNTHETIC_REVIEW_VERSION], 're-key this fixture').toBeUndefined()
    REVIEW_RENDERS[SYNTHETIC_REVIEW_VERSION] = REVIEW_V2
  })
  afterAll(() => {
    delete REVIEW_RENDERS[SYNTHETIC_REVIEW_VERSION]
  })

  // As on the field-audit side: a regression guard on version 1's values
  // only. Pinning 1 and pinning nothing are the same object, so the routing
  // claim is carried by the cases below.
  it("renders version 1's values", async () => {
    const { requests, callModel } = captor({
      outcome: 'compliant',
      rationale: 'Fine.',
      quote: null,
      block_index: null,
      proposed_language: null,
    })
    await runReviewPlaybook(LAYER, PLAYBOOK, { renderVersion: 1, callModel })
    const request = requests[0]
    expect(request.max_tokens).toBe(1024)
    expect((request.tools as Array<{ name: string }>)[0].name).toBe('report_finding')
    expect((request.system as Array<{ text: string }>)[0].text).toBe(REVIEW_RENDERS[1].instructions)
    expect((request.tool_choice as { name: string }).name).toBe('report_finding')
  })

  it('sends version 2 wholesale for a run pinning 2', async () => {
    const { requests, callModel } = captor({ outcome: 'compliant', q: LAYER_TEXT, b: 0 })
    await runReviewPlaybook(LAYER, PLAYBOOK, {
      renderVersion: SYNTHETIC_REVIEW_VERSION,
      callModel,
    })
    const request = requests[0]
    expect(request.max_tokens).toBe(55)
    expect((request.tools as Array<{ name: string }>)[0].name).toBe('report_finding_v2')
    expect((request.system as Array<{ text: string }>)[0].text).toBe('Review version two.')
    expect((request.system as Array<{ text: string }>)[1].text).toBe('V2 document')
    expect((request.messages as Array<{ content: string }>)[0].content).toBe('V2 rule 1')
  })

  /**
   * The parse routes too, and this is the assertion a single-version registry
   * could never make: the same answer shape anchors a citation under the
   * version that declares its field names and supports nothing under the
   * version that does not.
   */
  it('parses with the pinned version, not the current one', async () => {
    const v2Answer = { outcome: 'deviation', q: LAYER_TEXT, b: 0 }

    const underTwo = await runReviewPlaybook(LAYER, PLAYBOOK, {
      renderVersion: SYNTHETIC_REVIEW_VERSION,
      callModel: captor(v2Answer).callModel,
    })
    expect(underTwo.findings[0].citation?.quote).toBe(LAYER_TEXT)

    // Version 1's parser reads `quote`/`block_index`, which this answer does
    // not have, so it finds nothing to verify and the finding carries no
    // citation at all.
    const underOne = await runReviewPlaybook(LAYER, PLAYBOOK, {
      renderVersion: 1,
      callModel: captor(v2Answer).callModel,
    })
    expect(underOne.findings[0].citation).toBeNull()
    expect(underOne.findings[0].attemptedQuote).toBeNull()
  })

  /** The citation gate is current code, whatever version parsed the answer. */
  it('verifies a v2 quote with the current verifier', async () => {
    const { requests, callModel } = captor({ outcome: 'compliant', q: LAYER_TEXT, b: 0 })
    const result = await runReviewPlaybook(LAYER, PLAYBOOK, {
      renderVersion: SYNTHETIC_REVIEW_VERSION,
      callModel,
    })
    // Version 2 is what was actually asked, not merely what parsed the reply
    // — without this line the case would pass on a v1 render that happened to
    // produce the same conclusion.
    expect(requests[0].max_tokens).toBe(55)
    expect(result.findings[0].citation?.verification).toBe('verified')
  })

  /**
   * And the gate still refuses an unverifiable v2 quote: a quote absent from
   * the document is kept as an attempt and carries no citation, whatever
   * version's parser read it out.
   */
  it('applies the current gate whatever version the run pinned', async () => {
    const { requests, callModel } = captor({
      outcome: 'deviation',
      q: 'The trustee shall distribute income quarterly.',
      b: 0,
    })
    const result = await runReviewPlaybook(LAYER, PLAYBOOK, {
      renderVersion: SYNTHETIC_REVIEW_VERSION,
      callModel,
    })
    expect(requests[0].max_tokens).toBe(55)
    expect(result.findings[0].citation).toBeNull()
    expect(result.findings[0].citationRefusal).not.toBeNull()
    expect(result.findings[0].attemptedQuote).toBe('The trustee shall distribute income quarterly.')
  })

  /** And it fails before spending a model call, not partway through a batch. */
  it('throws before calling the model when the version is unknown', async () => {
    let called = false
    await expect(
      runReviewPlaybook(LAYER, PLAYBOOK, {
        renderVersion: 42,
        callModel: async () => {
          called = true
          return { content: [] } as never
        },
      }),
    ).rejects.toThrow(/version 42/)
    expect(called).toBe(false)
  })
})

/**
 * Two real versions now exist, so the routing property can be asserted
 * against production entries rather than a synthetic fixture — which is what
 * the fixture was always standing in for.
 *
 * Version 2 exists for one measured reason. On a client_review sheet, check 2
 * reported a blocker on ten consecutive runs across three prompt versions
 * while its own rationale concluded the opposite, and every rationale read as
 * thinking-out-loud ("wait, actually…"). Version 1's schema asks for
 * `outcome` first and `rationale` second, so the model commits to a
 * conclusion and reasons underneath it. Version 2 asks in the other order.
 */
describe('field-audit render version 2', () => {
  const propsOf = (v: number) =>
    Object.keys(
      (FIELD_AUDIT_RENDERS[v].tool.input_schema as { properties: Record<string, unknown> }).properties,
    )

  it('asks for the rationale before the outcome', () => {
    const order = propsOf(2)
    expect(order.indexOf('rationale')).toBeLessThan(order.indexOf('outcome'))
    const required = (FIELD_AUDIT_RENDERS[2].tool.input_schema as { required: string[] }).required
    expect(required.indexOf('rationale')).toBeLessThan(required.indexOf('outcome'))
  })

  /**
   * Version 1 is a record of what earlier runs were actually asked, and ten of
   * them are in the database. If a tidy-up ever reordered it, those runs would
   * replay against a question they were never put.
   */
  it('leaves version 1 asking for the outcome first', () => {
    const order = propsOf(1)
    expect(order.indexOf('outcome')).toBeLessThan(order.indexOf('rationale'))
  })

  /** The reuse convention, asserted by identity: only the tool diverged. */
  it('reuses every version 1 piece except the tool', () => {
    const one = FIELD_AUDIT_RENDERS[1]
    const two = FIELD_AUDIT_RENDERS[2]
    expect(two.instructions).toBe(one.instructions)
    expect(two.sheet).toBe(one.sheet)
    expect(two.checkMessage).toBe(one.checkMessage)
    expect(two.parse).toBe(one.parse)
    expect(two.maxTokens).toBe(one.maxTokens)
    expect(two.tool).not.toBe(one.tool)
  })

  it('is what a new run gets', () => {
    expect(CURRENT_FIELD_AUDIT_RENDER_VERSION).toBe(2)
  })

  /** Same field names, so version 1's parser reads version 2 unchanged. */
  it('keeps the input shape, so the parser did not have to move', () => {
    expect(propsOf(2).sort()).toEqual(propsOf(1).sort())
  })

  /**
   * The routing property, now on real entries: a run pinning 1 is sent
   * version 1's schema and a run pinning 2 is sent version 2's. Break the
   * engine to resolve the current version instead of the run's, and the first
   * of these fails.
   */
  it('sends each run the schema its own version declares', async () => {
    const seen: string[][] = []
    for (const version of [1, 2]) {
      await runFieldAudit(
        { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: version },
        BODY,
        {
          callModel: async (request) => {
            const tool = (request as { tools: Array<{ input_schema: { properties: Record<string, unknown> } }> }).tools[0]
            seen.push(Object.keys(tool.input_schema.properties))
            return {
              content: [{ type: 'tool_use', id: 't', name: 'report_check', input: { outcome: 'compliant', rationale: 'Fine.', references: [] } }],
            } as never
          },
        },
      )
    }
    expect(seen[0].indexOf('outcome')).toBeLessThan(seen[0].indexOf('rationale'))
    expect(seen[1].indexOf('rationale')).toBeLessThan(seen[1].indexOf('outcome'))
  })
})
