# Render Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin everything *code* contributes to a run's model call behind one version integer per run, so a retry weeks later asks the same question the run opened with.

**Architecture:** One `Render` object per version per kind, in a registry keyed by the integer stored on `workflow_runs.render_version` (renamed from `instructions_version`). The engine resolves the run's entry once, before any model call, and takes the instructions, tool schema, tool name, `max_tokens`, message wrapper, input formatter and response parser from it. The *gate* — quote/reference verification and the refusal of an unsupported finding — deliberately stays outside the registry at current code.

**Tech Stack:** TypeScript, `@aubrey-law/citations` (no runner of its own — tests live in `apps/workbench/tests/`), vitest 4, Supabase Postgres, `@anthropic-ai/sdk` forced tool use.

**Spec:** `docs/superpowers/specs/2026-09-08-render-versioning-design.md`

---

## Worktree

All work happens in **`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`** on branch `claude/tool-schema-version-2`. Do not `cd` to the repository root. **Never use `git stash`** — the stash stack is shared with the main checkout.

## How to run tests

`packages/citations` has no test runner. Its behaviour is tested from the workbench project, whose `tests/**` paths are relative to `apps/workbench`:

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

A bare `npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and exits 0** — it looks like a pass. Always use the command above.

Typecheck both projects:

```bash
npm run typecheck --workspace apps/workbench && npm run typecheck
```

## File structure

| File | Responsibility |
| --- | --- |
| `packages/citations/src/fieldAudit/render.ts` | **new.** `FieldAuditRender`, `ParsedFieldAuditAnswer`, `FIELD_AUDIT_RENDERS`, `CURRENT_FIELD_AUDIT_RENDER_VERSION`, `fieldAuditRender()`, `FIELD_AUDIT_TOOL_NAME`, and version 1's instructions / tool / formatters / parser. |
| `packages/citations/src/fieldAudit/runFieldAudit.ts` | The loop, the gate (`verifyFieldReference` + the empty-references refusal), and the answer helpers (`isActionable`, `actionableFindings`, `answerForFinding`, `runAnswers`). Loses the tool constant, the instructions registry, the formatters and the parsing half of `findingForCheck`. |
| `packages/citations/src/review/render.ts` | **new.** The same for review: `ReviewRender`, `ParsedReviewAnswer`, `REVIEW_RENDERS`, `CURRENT_REVIEW_RENDER_VERSION`, `reviewRender()`, `REVIEW_TOOL_NAME`, version 1's pieces. |
| `packages/citations/src/review/runReview.ts` | The loop, the citation gate, `exportableFindings` and the redline filter. |
| `supabase/migrations/20261109000000_run_render_version.sql` | **new.** The column rename and its comment. |
| `packages/db-types/src/supabase.generated.ts` | Regenerated. |
| `apps/workbench/lib/runs/{context,record,worker}.ts` | Select, stamp and forward `render_version`. |
| `apps/workbench/tests/render-versions.test.ts` | **new**, replacing `instruction-versions.test.ts`. |

The package's `exports` map already wildcards `./fieldAudit/*` and `./review/*`, so the new files need no manifest change.

---

### Task 1: The field-audit render module

Create the registry beside the existing constants without touching the engine yet, and prove the extraction is faithful. Both copies exist for exactly one commit; Task 2 deletes the old ones.

**Files:**
- Create: `packages/citations/src/fieldAudit/render.ts`
- Create: `apps/workbench/tests/render-versions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/workbench/tests/render-versions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  fieldAuditRender,
} from '@aubrey-law/citations/fieldAudit/render'
import {
  FIELD_AUDIT_INSTRUCTIONS,
  FIELD_AUDIT_TOOL,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'

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
    for (const [version, render] of Object.entries(FIELD_AUDIT_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      expect(typeof render.checkMessage, `v${version} checkMessage`).toBe('function')
      expect(typeof render.sheet, `v${version} sheet`).toBe('function')
      expect(typeof render.parse, `v${version} parse`).toBe('function')
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
 * The extraction has to change nothing. These compare version 1's entry
 * against the constants the engine uses today; Task 2 removes the old
 * constants and these assertions go with them.
 */
describe('version 1 is today behaviour, moved', () => {
  it('carries the same instruction text', () => {
    expect(FIELD_AUDIT_RENDERS[1].instructions).toBe(FIELD_AUDIT_INSTRUCTIONS[1])
  })

  it('carries the same tool', () => {
    expect(FIELD_AUDIT_RENDERS[1].tool).toEqual(FIELD_AUDIT_TOOL)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: FAIL — `Cannot find module '@aubrey-law/citations/fieldAudit/render'`.

- [ ] **Step 3: Create the render module**

Create `packages/citations/src/fieldAudit/render.ts`. The instruction text, tool object, `checkMessage`, `sheetForPrompt` and `formatFieldValue` bodies are **copied verbatim** from `runFieldAudit.ts` — do not reword them, and keep their comments, which explain why each is shaped the way it is.

```ts
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { FieldAuditCheck } from '../prompt/body'
import { collectLeaves } from './verify'
import type { FieldReferenceClaim } from './types'

/**
 * What a model was actually asked, minus the data.
 *
 * `workflow_runs` pins `prompt_version_id` (immutable checks) and
 * `resolved_inputs` (the sheet), so the *data* half of a unit's call survives
 * a retry unchanged. This is the other half: everything the code contributes.
 * It used to be module constants read at the moment of the call — and the call
 * can come much later, because `retryFailedSteps` sets failed steps back to
 * `pending` and the next tick works them against whatever is deployed then.
 *
 * #424 pinned the instruction text alone. That left the tool schema, the tool
 * name, the message wrapper, the sheet formatter and `max_tokens` free to move
 * under a run mid-flight. They are versioned together rather than on separate
 * axes because separate axes make combinations representable that never ran
 * — instructions v1 with tool v3 — and replay would construct them while
 * reporting fidelity.
 *
 * The tool *name* belongs here and that is easy to miss: `runPrompt`'s
 * `readToolInput` matches the response block by name, so a version that
 * renames the tool and leaves the matcher behind reads nothing from every unit
 * and fails the run for a reason that looks like a model problem.
 *
 * **The model id is deliberately not here.** It is pinned per run on
 * `workflow_runs.model`; a second home for it could disagree with the first.
 *
 * **The gate is deliberately not here either** — see the note on `parse`.
 */
export interface FieldAuditRender {
  instructions: string
  tool: {
    name: string
    description: string
    input_schema: Record<string, unknown>
  }
  maxTokens: number
  /** How one check's user message is worded. */
  checkMessage: (check: FieldAuditCheck) => string
  /** How the sheet block is built from resolved inputs. */
  sheet: (values: Record<string, unknown>) => string
  /**
   * Reads this version's tool input into claims.
   *
   * Only shape lives here, because shape is what the schema decides: if a
   * later version renames `field_key`, its parser moves with it. What must
   * *not* live here is the gate — `verifyFieldReference` on each claim, and
   * the refusal of a `deviation`/`absent` with no references at all. A run's
   * question must not change after it opens; a run's conclusion is allowed to
   * improve. Versioning the gate would let a run opened before a gate fix
   * escape that fix on retry, which is the opposite of what #422 was for.
   *
   * Validating `outcome` is also the engine's job, not this one's: it asks
   * whether an answer is answerable at all, and a v2 schema offering a fifth
   * outcome should still be refused by a build that does not know it. So
   * `outcome` comes back unvalidated.
   */
  parse: (input: Record<string, unknown>) => ParsedFieldAuditAnswer
}

export interface ParsedFieldAuditAnswer {
  /** Unvalidated on purpose — the engine decides what is a legal outcome. */
  outcome: unknown
  rationale: string | null
  claims: FieldReferenceClaim[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

const TOOL_NAME_V1 = 'report_check'

/**
 * Forced tool use, not free text — the same reasoning as the review tool: a
 * strict `input_schema` with `tool_choice` pinned to this tool makes the
 * response shape the model's problem, not a regex's.
 */
const TOOL_V1: FieldAuditRender['tool'] = {
  name: TOOL_NAME_V1,
  description: "Report the conclusion for exactly one check against the matter's design sheet.",
  input_schema: {
    type: 'object' as const,
    properties: {
      outcome: {
        type: 'string',
        enum: ['compliant', 'deviation', 'absent', 'not_applicable'],
        description:
          'compliant: the sheet meets the check. deviation: it addresses the point but not acceptably. absent: the sheet is silent on a point the check requires. not_applicable: the check does not bear on this matter.',
      },
      rationale: {
        type: 'string',
        description: 'One or two sentences. Say what the sheet records, not what it should record.',
      },
      references: {
        type: 'array',
        description:
          'The fields this conclusion rests on. Every field named here must be one the check lists as its reads. A null claimed_value claims the field is empty.',
        items: {
          type: 'object',
          properties: {
            field_key: {
              type: 'string',
              description: 'One of the field keys this check may consult.',
            },
            claimed_value: {
              type: ['string', 'null'],
              description: 'What the field holds, copied exactly. Null claims the field is empty.',
            },
          },
          required: ['field_key', 'claimed_value'],
          additionalProperties: false,
        },
      },
    },
    required: ['outcome', 'rationale', 'references'],
    additionalProperties: false,
  },
}

const INSTRUCTIONS_V1 = `
You are auditing a matter's design sheet against one firm check at a time.

Rules for every answer:
- Quote field values exactly. Copy them as they appear; do not tidy
  punctuation, fix spacing, correct spelling, or paraphrase. A claimed value
  that does not match the field verbatim is discarded and your reference loses
  its support.
- Reference only the fields the check lists as its reads. A reference to any
  other field can never be verified.
- A field shown as several indented lines holds several values. Quote exactly
  one of them, copied from the right of the "=" — never a summary of the
  collection and never two values joined together. One value per reference;
  use several references when a conclusion rests on several values.
- Report what the sheet records, not what you would prefer it recorded.
- If the sheet is silent on the point, the outcome is "absent" — reference the
  field with a null claimed_value rather than referencing something adjacent.
- A null claimed_value is how you reference an empty field, whatever the
  outcome. A deviation often rests on emptiness: the notes ask for something
  and the fields meant to carry it hold nothing. Reference each of those
  fields with a null claimed_value. Naming them in your rationale is not
  referencing them.
- Do not report a deviation or an absence you cannot reference. An unsupported
  finding is worse than a missed one, and one with no references at all is
  rejected outright and asked again.

${PROMPT_INJECTION_GUARDRAIL}
`.trim()

function formatFieldValueV1(key: string, value: unknown): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return JSON.stringify(value)

  // A structured field is shown as the leaves it is made of, because those are
  // the only things a reference can be verified against. Serialising it whole
  // asks the model to quote a JSON document back character for character,
  // which it will not do — it summarises instead, and every summary fails
  // verification for a reason that is the prompt's fault rather than the
  // model's.
  const leaves = collectLeaves(value, key)
  if (leaves.length === 0) return '(empty)'
  return leaves.map((leaf) => `  ${leaf.path} = ${String(leaf.value)}`).join('\n')
}

function sheetV1(values: Record<string, unknown>): string {
  // Field keys are what the model references with, and they have to be the
  // keys `verifyFieldReference` looks up — otherwise the label is noise and
  // every claim fails for citing a key the sheet never showed.
  const lines = Object.entries(values)
    .map(([key, value]) => `[field: ${key}]\n${formatFieldValueV1(key, value)}`)
    .join('\n\n')
  return quoteUserContent('design_sheet', lines)
}

function checkMessageV1(check: FieldAuditCheck): string {
  const lines = [
    `Check ${check.number}: ${check.statement}`,
    '',
    `Fields you may reference: ${check.reads.join(', ')}`,
    '',
    `Report your conclusion for this check only, using the ${TOOL_NAME_V1} tool.`,
  ]
  return lines.join('\n')
}

/**
 * Claims with an empty field key are dropped here rather than after
 * verification. `verifyFieldReference` preserves `fieldKey`, so filtering
 * before or after it is the same set — this is the pre-existing behaviour of
 * `findingForCheck`, moved, not a change.
 */
function parseV1(input: Record<string, unknown>): ParsedFieldAuditAnswer {
  const raw = Array.isArray(input.references) ? input.references : []
  return {
    outcome: input.outcome,
    rationale: asString(input.rationale),
    claims: raw
      .filter((ref): ref is Record<string, unknown> => ref !== null && typeof ref === 'object')
      .map(ref => ({
        fieldKey: asString(ref.field_key) ?? '',
        claimedValue: asString(ref.claimed_value),
      }))
      .filter(claim => claim.fieldKey !== ''),
  }
}

/**
 * Every version of the field-audit render, keyed by the number a run pins in
 * `workflow_runs.render_version`.
 *
 * Old entries stay here rather than in git history, because replay is the
 * point: a run pinning version 1 must still be answerable when version 4 is
 * current. The file gets longer, which is the price of the property.
 *
 * Version 1 is the render as it stood when the instructions alone were
 * versioned in #424 — identical values, so nothing about a run's question
 * changed when this widened. Earlier variants of the instruction text exist in
 * git (the block changed in 0d42cc6a, 949771b3 and #410's successor) but
 * nothing records which text a given historical run used, so they are
 * deliberately not reconstructed. A run from before versioning carries a null
 * and falls back to the current entry — what it would have got anyway; the
 * null is there so the inconsistency can be reasoned about rather than
 * discovered.
 *
 * Later versions should reference these same functions for whatever has not
 * changed, so an entry copies only what actually diverges.
 */
export const FIELD_AUDIT_RENDERS: Record<number, FieldAuditRender> = {
  1: {
    instructions: INSTRUCTIONS_V1,
    tool: TOOL_V1,
    maxTokens: 1024,
    checkMessage: checkMessageV1,
    sheet: sheetV1,
    parse: parseV1,
  },
}

/** What `openRun` stamps on a new field-audit run. */
export const CURRENT_FIELD_AUDIT_RENDER_VERSION = 1

/**
 * The tool name of the *current* render.
 *
 * Derived rather than declared, so it cannot drift from the registry. Tests
 * build mock `tool_use` blocks with it; a run resolves its own version's name
 * from its own entry.
 */
export const FIELD_AUDIT_TOOL_NAME = FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION].tool.name

/**
 * The render a run pinned. A null version means the run predates versioning,
 * so it gets the current entry — the behaviour it would have had regardless.
 *
 * An unknown *number* is a hard error rather than a fallback. A run pinning a
 * version this registry has lost is a run nobody can honestly finish, and
 * quietly substituting a different render would answer a different question
 * while reporting the run's own version.
 */
export function fieldAuditRender(version: number | null | undefined): FieldAuditRender {
  if (version == null) return FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION]
  const render = FIELD_AUDIT_RENDERS[version]
  if (!render) {
    throw new Error(
      `No field-audit render recorded for version ${version}. ` +
        'A run cannot be finished against a render this build does not have.',
    )
  }
  return render
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: PASS, 6 tests. If "carries the same instruction text" or "carries the same tool" fails, the copy is not verbatim — fix the copy, not the test.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace apps/workbench && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/citations/src/fieldAudit/render.ts apps/workbench/tests/render-versions.test.ts
git commit -m "The field-audit render becomes a versioned object

Everything the code contributes to a unit's call -- instructions, tool schema,
tool name, max_tokens, message wrapper, sheet formatter and response parser --
moves into one entry per version. Version 1 holds today's values verbatim, and
two tests compare it against the constants the engine still uses, so the
extraction is provably a move rather than a rewrite. Task 2 removes the old
constants and those two tests with them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The field-audit engine reads the run's render

**Files:**
- Modify: `packages/citations/src/fieldAudit/runFieldAudit.ts`
- Modify: `apps/workbench/tests/render-versions.test.ts`
- Delete: `apps/workbench/tests/instruction-versions.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `describe('version 1 is today behaviour, moved', …)` block in `apps/workbench/tests/render-versions.test.ts` with the block below, and add the imports it needs. This is where the mechanism is actually proved: with one entry in the registry every assertion about "the pinned version" is vacuous, so the tests **construct a second version** and route against it.

Add to the imports at the top of the file:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FieldAuditRender } from '@aubrey-law/citations/fieldAudit/render'
import { runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'
```

Remove the now-dead imports of `FIELD_AUDIT_INSTRUCTIONS` and `FIELD_AUDIT_TOOL` from `runFieldAudit`, and delete the `describe('version 1 is today behaviour, moved', …)` block. Then append:

```ts
const CHECK = {
  number: '1',
  statement: 'Every concern has a provision.',
  risk: 'blocker' as const,
  reads: ['concerns'],
  taskTemplate: {
    title: 'A concern is unanswered',
    description: 'Confirm it.',
    priority: 'high' as const,
  },
}
const BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
  checks: [CHECK],
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
    const result = await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, renderVersion: 2 },
      BODY,
      { callModel: captor({ outcome: 'deviation', rationale: 'Missing.', refs: [] }).callModel },
    )
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
```

Add `FIELD_AUDIT_TOOL_NAME` to the import from `@aubrey-law/citations/fieldAudit/render`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: FAIL. `renderVersion` is not a property of `FieldAuditContext`, so the engine still resolves `instructionsVersion` (undefined → current) and every version-2 assertion reports version 1's values — `max_tokens` 1024 rather than 77, tool name `report_check` rather than `report_check_v2`.

- [ ] **Step 3: Rewrite the engine to consume the render**

In `packages/citations/src/fieldAudit/runFieldAudit.ts`:

1. **Delete** `FIELD_AUDIT_TOOL_NAME`, `FIELD_AUDIT_TOOL`, `FIELD_AUDIT_INSTRUCTIONS`, `CURRENT_FIELD_AUDIT_INSTRUCTIONS_VERSION`, `fieldAuditInstructions`, `formatFieldValue`, `sheetForPrompt` and `checkMessage`.
2. **Re-export** the names other modules import, so callers keep one import site:

```ts
export {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  FIELD_AUDIT_TOOL_NAME,
  fieldAuditRender,
} from './render'
export type { FieldAuditRender, ParsedFieldAuditAnswer } from './render'
```

3. Replace the imports at the top with:

```ts
import type { FieldAuditBody, FieldAuditCheck } from '../prompt/body'
import { runPrompt, type RunPromptDependencies } from '../prompt/runPrompt'
import type { ModelCaller, ModelRequest } from '../review/model'
import { fieldAuditRender, type FieldAuditRender } from './render'
import { verifyFieldReference } from './verify'
import type { FieldAuditFinding, FieldAuditResult, FieldReference } from './types'
```

`PROMPT_INJECTION_GUARDRAIL`, `quoteUserContent` and `collectLeaves` are no longer used here — they moved to `render.ts`.

4. Rename the context field:

```ts
export interface FieldAuditContext {
  promptSlug: string
  promptVersion: number
  /**
   * Which render to use, from `workflow_runs.render_version`. Null for a run
   * made before the render was versioned.
   */
  renderVersion?: number | null
  values: Record<string, unknown>
  matterId?: string | null
  userId?: string | null
}
```

5. Replace `findingForCheck` with the version below. It keeps the whole gate and its comments, and takes the claims from the render's parser instead of reading the tool input itself:

```ts
/**
 * Turns one check's parsed answer into a finding, verifying every claim
 * against `values` on the way. Throws for an answer `runPrompt` should record
 * as a failure rather than a finding, so the specific reason travels with it.
 *
 * The shape of the tool input is the render's business (see `render.ts`); what
 * is left here is the gate, which is never versioned. `outcome` arrives
 * unvalidated for that reason: a later schema offering a fifth outcome must
 * still be refused by a build that does not know it.
 */
function findingForCheck(
  check: FieldAuditCheck,
  render: FieldAuditRender,
  input: Record<string, unknown>,
  values: Record<string, unknown>,
): FieldAuditFinding {
  const answer = render.parse(input)
  const outcome = answer.outcome
  if (
    outcome !== 'compliant' &&
    outcome !== 'deviation' &&
    outcome !== 'absent' &&
    outcome !== 'not_applicable'
  ) {
    throw new Error(`Unrecognised outcome ${String(outcome)}`)
  }

  const references: FieldReference[] = answer.claims.map(claim =>
    verifyFieldReference(values, check.reads, claim),
  )

  // A deviation or an absence with nothing offered in support is not a
  // finding, it is an unanswered call.
  //
  // The instructions already say so — "do not report a deviation or an
  // absence you cannot reference" — and nothing used to enforce it. The
  // schema cannot: `references` is required but has no `minItems`, and
  // `minItems` could not be made conditional on `outcome` anyway. So an empty
  // array arrived here, became a finished finding, and was refused by
  // `actionableFindings` later — leaving a blocker-severity deviation in the
  // database supported by nothing, producing no task, and (before the
  // withdrawal-scoping fix) retiring a previous run's real one. That is the
  // measured cause of the reference-count drift's *consequence*: 4, 0, 5, 5
  // verified references across five runs of one check against an unchanged
  // sheet.
  //
  // Throwing is how a unit fails: `runPrompt` catches whatever `findingFor`
  // threw, records the message as the failure reason and settles the step
  // `ok: false`, so this becomes a visible, retryable failure rather than a
  // silent one.
  //
  // The line is drawn on what was *emitted*, not on what verified. A
  // reference that was offered and failed verification means the model tried
  // and got it wrong, which is exactly what the gate exists to catch and must
  // stay a finding — conflating the two would trade a substantive
  // disagreement for a retry loop. Only `deviation` and `absent` are held to
  // this: a `compliant` or `not_applicable` conclusion legitimately rests on
  // nothing needing citation, and demanding references there would invite
  // invented ones.
  //
  // This is deliberately outside the render: a gate fix must reach a run that
  // opened before it, which is the opposite of how the question is treated.
  if ((outcome === 'deviation' || outcome === 'absent') && references.length === 0) {
    throw new Error(
      `Check ${check.number} reported "${outcome}" with no field references. ` +
        'A deviation or absence must name at least one field it rests on — ' +
        'an empty field is referenced with a null claimed value.',
    )
  }

  return {
    checkNumber: check.number,
    outcome,
    severity: outcome === 'deviation' || outcome === 'absent' ? check.risk : null,
    rationale: answer.rationale ?? '',
    references,
  }
}
```

6. Rewrite the body of `runFieldAudit` to resolve the render once and take everything from it:

```ts
export async function runFieldAudit(
  context: FieldAuditContext,
  body: FieldAuditBody,
  deps: RunFieldAuditDependencies,
): Promise<FieldAuditResult> {
  const model = deps.model ?? 'claude-sonnet-5'
  // Resolved once, before any call: a run that pins a version this build does
  // not have should fail before spending a model call, not partway through.
  const render = fieldAuditRender(context.renderVersion)
  const sheet = render.sheet(context.values)

  const run = await runPrompt<FieldAuditCheck, FieldAuditFinding>(
    {
      units: body.checks,
      toolName: render.tool.name,
      idFor: check => check.number,
      requestFor: check =>
        ({
          model,
          max_tokens: render.maxTokens,
          system: [
            { type: 'text', text: render.instructions },
            // Static prefix, cached. Everything that varies comes after it.
            { type: 'text', text: sheet, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: render.checkMessage(check) }],
          tools: [render.tool],
          tool_choice: { type: 'tool', name: render.tool.name },
        }) as ModelRequest,
      findingFor: (check, input) => findingForCheck(check, render, input, context.values),
    },
    {
      callModel: deps.callModel,
      context: {
        route: 'field_audit/prompt',
        matterId: context.matterId ?? null,
        userId: context.userId ?? null,
        contextType: 'matter',
      },
      onUnitSettled: deps.onUnitSettled,
    },
  )

  return {
    promptSlug: context.promptSlug,
    promptVersion: context.promptVersion,
    findings: run.findings,
    failures: run.failures.map(failure => ({ checkNumber: failure.unitId, reason: failure.reason })),
  }
}
```

7. Delete `apps/workbench/tests/instruction-versions.test.ts`. Its cases are all carried in `render-versions.test.ts`, and it imports names that no longer exist. **Note for the reviewer:** its old mock at line 84 answered with a tool named `report_field_audit_finding`, which no tool has ever been called — it passed only because that case asserted on captured system text and never on the finding. The replacement's `captor` reads the name out of the request it is answering, so a mock can no longer disagree with the tool it is meant to be answering.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole workbench suite**

```bash
npm run test --workspace apps/workbench
```

Expected: `field-audit-run.test.ts` and `run-worker.test.ts` still pass — they import `FIELD_AUDIT_TOOL_NAME`, which `runFieldAudit.ts` re-exports. `run-worker.test.ts` still refers to `instructions_version`, which is fine until Task 6.

If a test fails because it passed `instructionsVersion`, change it to `renderVersion` — that rename is the point.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck --workspace apps/workbench && npm run typecheck
git add -A packages/citations/src/fieldAudit apps/workbench/tests
git commit -m "The field-audit engine asks the run's own render

runFieldAudit resolves one render from the version the run pinned and takes the
instructions, tool, tool name, max_tokens, message wrapper and sheet format
from it. The module constants are gone, so there is no second source a run
could silently be answered against.

findingForCheck splits along the line the design draws: the render parses the
tool input, because shape is what the schema decides, and everything after --
verifying each claim, and refusing a deviation or absence with no references --
stays at current code, because a gate fix must reach a run that opened before
it.

The tests construct a synthetic version 2 rather than asserting against a
one-entry registry, where 'the pinned version' and 'the current version' are
the same object and nothing can fail. A v2-shaped answer verifies under 2 and
fails its unit under 1; an unsupported v2 deviation still trips #422's refusal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The review render module

**Files:**
- Create: `packages/citations/src/review/render.ts`
- Modify: `apps/workbench/tests/render-versions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/workbench/tests/render-versions.test.ts`:

```ts
import {
  CURRENT_REVIEW_RENDER_VERSION,
  REVIEW_RENDERS,
  REVIEW_TOOL_NAME,
  reviewRender,
} from '@aubrey-law/citations/review/render'

describe('the review render registry', () => {
  it('resolves the current version to a complete entry', () => {
    const render = reviewRender(CURRENT_REVIEW_RENDER_VERSION)
    expect(render.instructions.trim().length).toBeGreaterThan(0)
    expect(render.tool.name.length).toBeGreaterThan(0)
    expect(render.maxTokens).toBeGreaterThan(0)
  })

  it('has no half-built entry', () => {
    for (const [version, render] of Object.entries(REVIEW_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      expect(typeof render.ruleMessage, `v${version} ruleMessage`).toBe('function')
      expect(typeof render.document, `v${version} document`).toBe('function')
      expect(typeof render.parse, `v${version} parse`).toBe('function')
    }
  })

  it('falls back to current for a run made before versioning', () => {
    expect(reviewRender(null)).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION])
    expect(reviewRender(undefined)).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION])
  })

  it('refuses a version it does not have, rather than substituting one', () => {
    expect(() => reviewRender(99)).toThrow(/version 99/)
  })

  it('exports the current render tool name', () => {
    expect(REVIEW_TOOL_NAME).toBe(REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION].tool.name)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: FAIL — `Cannot find module '@aubrey-law/citations/review/render'`.

- [ ] **Step 3: Create the review render module**

Create `packages/citations/src/review/render.ts`. The tool object and instruction text are **copied verbatim** from `runReview.ts`; `document` and `ruleMessage` are `documentForPrompt` and `ruleMessage` moved with their comments.

```ts
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { TextLayer } from '../textLayer/types'
import type { ReviewRule } from './types'

/**
 * What a model was actually asked, minus the document.
 *
 * See `../fieldAudit/render.ts` for the full argument: the data half of a
 * unit's call is pinned on the run row, this is the half the code contributes,
 * and it is versioned as one object rather than per piece so that replay
 * cannot construct a combination that never ran.
 *
 * A separate registry from the field audit's, because a render is per kind:
 * these instructions are about anchoring a citation in a document, those about
 * quoting a design-sheet field. `workflow_runs.kind` and `render_version`
 * together name one render.
 */
export interface ReviewRender {
  instructions: string
  tool: {
    name: string
    description: string
    input_schema: Record<string, unknown>
  }
  maxTokens: number
  /** How one rule's user message is worded. */
  ruleMessage: (rule: ReviewRule) => string
  /** How the document block is built from the text layer. */
  document: (layer: TextLayer) => string
  /**
   * Reads this version's tool input into a claim about the document.
   *
   * Shape only. `verifyQuote` and the decision about what a finding may
   * support stay in the engine at current code — a run's question must not
   * change after it opens, but its conclusion is allowed to improve.
   */
  parse: (input: Record<string, unknown>) => ParsedReviewAnswer
}

export interface ParsedReviewAnswer {
  /** Unvalidated on purpose — the engine decides what is a legal outcome. */
  outcome: unknown
  rationale: string | null
  quote: string | null
  blockIndex: number | null
  proposedLanguage: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

const TOOL_NAME_V1 = 'report_finding'

/**
 * Forced tool use, not free text.
 *
 * The route this replaces asks for JSON in prose and then runs
 * `raw.match(/\[[\s\S]*\]/)` over the reply — which parses a model's
 * conversational aside as data whenever it happens to contain a bracket. A
 * strict `input_schema` with `tool_choice` pinned to this tool makes the shape
 * the model's problem instead of the parser's.
 */
const TOOL_V1: ReviewRender['tool'] = {
  name: TOOL_NAME_V1,
  description: 'Report the conclusion for exactly one rule against the document under review.',
  input_schema: {
    type: 'object' as const,
    properties: {
      outcome: {
        type: 'string',
        enum: ['compliant', 'deviation', 'absent', 'not_applicable'],
        description:
          'compliant: the document meets the rule. deviation: it addresses the point but not acceptably. absent: the document is silent on a point the rule requires. not_applicable: the rule does not bear on this kind of document.',
      },
      rationale: {
        type: 'string',
        description: 'One or two sentences. Say what the document does, not what it should do.',
      },
      quote: {
        type: ['string', 'null'],
        description:
          'The exact text from the document that supports this conclusion, copied character for character. Null when the outcome is absent or not_applicable, where by definition there is nothing to quote.',
      },
      block_index: {
        type: ['integer', 'null'],
        description: 'The ¶ number shown beside the quoted text in the document.',
      },
      proposed_language: {
        type: ['string', 'null'],
        description:
          'Replacement text for the quoted span, when the quoted text should be rewritten. Null otherwise.',
      },
    },
    required: ['outcome', 'rationale', 'quote', 'block_index', 'proposed_language'],
    additionalProperties: false,
  },
}

const INSTRUCTIONS_V1 = `
You are reviewing a legal instrument against one firm position at a time.

Rules for every answer:
- Quote the document exactly. Copy the characters as they appear; do not tidy
  punctuation, fix spacing, correct spelling, or paraphrase. A quote that does
  not appear verbatim in the document is discarded and your finding loses its
  support.
- Give the paragraph number shown beside the text you quote.
- Report what the document says, not what you would prefer it said.
- If the document is silent on the point, the outcome is "absent" and there is
  nothing to quote. Say so rather than quoting something adjacent.
- Do not report a deviation you cannot quote. An unsupported finding is worse
  than a missed one.

${PROMPT_INJECTION_GUARDRAIL}
`.trim()

function documentV1(layer: TextLayer): string {
  // Paragraph numbers are what the model cites with, and they have to be the
  // block indexes the verifier scopes by — otherwise the hint is noise and
  // every quote falls back to a whole-document search.
  const numbered = layer.blocks.map(block => `[¶ ${block.index}] ${block.text}`).join('\n\n')
  return quoteUserContent('document_under_review', numbered)
}

function ruleMessageV1(rule: ReviewRule): string {
  const lines = [`Rule ${rule.number}: ${rule.statement}`]
  if (rule.preferredLanguage) {
    lines.push('', `The firm's preferred language for this point:`, rule.preferredLanguage)
  }
  lines.push('', `Report your conclusion for this rule only, using the ${TOOL_NAME_V1} tool.`)
  return lines.join('\n')
}

function parseV1(input: Record<string, unknown>): ParsedReviewAnswer {
  return {
    outcome: input.outcome,
    rationale: asString(input.rationale),
    quote: asString(input.quote),
    blockIndex: typeof input.block_index === 'number' ? input.block_index : null,
    proposedLanguage: asString(input.proposed_language),
  }
}

/**
 * Every version of the review render, keyed by the number a run pins in
 * `workflow_runs.render_version`. See `../fieldAudit/render.ts`'s registry for
 * why old entries stay here and why earlier instruction variants are not
 * reconstructed.
 */
export const REVIEW_RENDERS: Record<number, ReviewRender> = {
  1: {
    instructions: INSTRUCTIONS_V1,
    tool: TOOL_V1,
    maxTokens: 1024,
    ruleMessage: ruleMessageV1,
    document: documentV1,
    parse: parseV1,
  },
}

/** What `openRun` stamps on a new review run. */
export const CURRENT_REVIEW_RENDER_VERSION = 1

/**
 * The tool name of the *current* render. Derived rather than declared, so it
 * cannot drift from the registry.
 */
export const REVIEW_TOOL_NAME = REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION].tool.name

export function reviewRender(version: number | null | undefined): ReviewRender {
  if (version == null) return REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION]
  const render = REVIEW_RENDERS[version]
  if (!render) {
    throw new Error(
      `No review render recorded for version ${version}. ` +
        'A run cannot be finished against a render this build does not have.',
    )
  }
  return render
}
```

- [ ] **Step 4: Run the tests, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
npm run typecheck --workspace apps/workbench && npm run typecheck
git add packages/citations/src/review/render.ts apps/workbench/tests/render-versions.test.ts
git commit -m "The review render becomes a versioned object

The same registry as the field audit's, for the other kind: instructions, tool,
tool name, max_tokens, rule-message wrapper, document formatter and parser in
one entry per version. Separate registry because a render is per kind -- kind
and render_version together name one render -- and version 1 holds today's
values verbatim.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The review engine reads the run's render

**Files:**
- Modify: `packages/citations/src/review/runReview.ts`
- Modify: `apps/workbench/tests/render-versions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/workbench/tests/render-versions.test.ts`. A review needs a text layer, so this uses a two-block one and asserts the request carries the pinned render.

```ts
import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ReviewRender } from '@aubrey-law/citations/review/render'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

const LAYER: TextLayer = {
  status: 'ok',
  blocks: [
    { index: 1, text: 'The trustee shall distribute income annually.', start: 0, end: 44 },
  ],
  text: 'The trustee shall distribute income annually.',
}

const RULE = {
  number: '1',
  statement: 'Income distribution is stated.',
  risk: 'high' as const,
  preferredLanguage: null,
}

const REVIEW_V2: ReviewRender = {
  instructions: 'Review version two.',
  tool: {
    name: 'report_finding_v2',
    description: 'Version two.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
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
    REVIEW_RENDERS[2] = REVIEW_V2
  })
  afterAll(() => {
    delete REVIEW_RENDERS[2]
  })

  it('sends version 2 wholesale for a run pinning 2', async () => {
    const requests: Array<Record<string, unknown>> = []
    await runReviewPlaybook(
      LAYER,
      { slug: 'p', title: 'P', version: 1, rules: [RULE] },
      {
        renderVersion: 2,
        callModel: async request => {
          const typed = request as Record<string, unknown>
          requests.push(typed)
          return {
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'report_finding_v2',
                input: { outcome: 'compliant', q: 'The trustee shall distribute income annually.', b: 1 },
              },
            ],
          } as never
        },
      },
    )
    const request = requests[0]
    expect(request.max_tokens).toBe(55)
    expect((request.tools as Array<{ name: string }>)[0].name).toBe('report_finding_v2')
    expect((request.system as Array<{ text: string }>)[0].text).toBe('Review version two.')
    expect((request.system as Array<{ text: string }>)[1].text).toBe('V2 document')
    expect((request.messages as Array<{ content: string }>)[0].content).toBe('V2 rule 1')
  })

  /** The citation gate is current code, whatever version parsed the answer. */
  it('verifies a v2 quote with the current verifier', async () => {
    const result = await runReviewPlaybook(
      LAYER,
      { slug: 'p', title: 'P', version: 1, rules: [RULE] },
      {
        renderVersion: 2,
        callModel: async () =>
          ({
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'report_finding_v2',
                input: { outcome: 'compliant', q: 'The trustee shall distribute income annually.', b: 1 },
              },
            ],
          }) as never,
      },
    )
    expect(result.findings[0].citation?.verification).toBe('verified')
  })

  it('throws before calling the model when the version is unknown', async () => {
    let called = false
    await expect(
      runReviewPlaybook(
        LAYER,
        { slug: 'p', title: 'P', version: 1, rules: [RULE] },
        {
          renderVersion: 42,
          callModel: async () => {
            called = true
            return { content: [] } as never
          },
        },
      ),
    ).rejects.toThrow(/version 42/)
    expect(called).toBe(false)
  })
})
```

If `TextLayer`'s block or layer shape does not match the literal above, read `packages/citations/src/textLayer/types.ts` and build the fixture to the real type — do not change the type to fit the fixture.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
```

Expected: FAIL — `renderVersion` is not a property of `RunReviewDependencies`, and the assertions report version 1's values (`max_tokens` 1024, tool `report_finding`).

- [ ] **Step 3: Rewrite the review engine**

In `packages/citations/src/review/runReview.ts`:

1. **Delete** `REVIEW_TOOL_NAME`, `REVIEW_TOOL`, `REVIEW_INSTRUCTIONS`, `CURRENT_REVIEW_INSTRUCTIONS_VERSION`, `reviewInstructions`, `documentForPrompt`, `ruleMessage` and the local `asString`.
2. **Re-export** for callers:

```ts
export {
  CURRENT_REVIEW_RENDER_VERSION,
  REVIEW_RENDERS,
  REVIEW_TOOL_NAME,
  reviewRender,
} from './render'
export type { ReviewRender, ParsedReviewAnswer } from './render'
```

3. Import the render and drop what moved:

```ts
import { runPrompt, type RunPromptDependencies } from '../prompt/runPrompt'
import { verifyQuote } from '../textLayer/match'
import type { TextLayer } from '../textLayer/types'
import type { ModelCaller, ModelRequest } from './model'
import { reviewRender, type ReviewRender } from './render'
import type { ReviewFinding, ReviewPlaybook, ReviewResult, ReviewRule } from './types'
```

4. In `RunReviewDependencies`, rename the field:

```ts
  /**
   * Which render to use, from `workflow_runs.render_version`. Null for a run
   * made before the render was versioned.
   */
  renderVersion?: number | null
```

5. Replace `findingForRule` so the render parses and the gate stays:

```ts
/**
 * Turns one rule's parsed answer into a finding, verifying its quote against
 * `layer` on the way. Throws for an answer `runPrompt` should record as a
 * failure rather than a finding, so the specific reason travels with it.
 *
 * The tool input's shape is the render's business; verification is not, and is
 * never versioned — a fix to the verifier must reach a run that opened before
 * it.
 */
function findingForRule(
  rule: ReviewRule,
  render: ReviewRender,
  input: Record<string, unknown>,
  layer: TextLayer,
): ReviewFinding {
  const answer = render.parse(input)
  const outcome = answer.outcome
  if (
    outcome !== 'compliant' &&
    outcome !== 'deviation' &&
    outcome !== 'absent' &&
    outcome !== 'not_applicable'
  ) {
    throw new Error(`Unrecognised outcome ${String(outcome)}`)
  }

  let citation: ReviewFinding['citation'] = null
  let citationRefusal: ReviewFinding['citationRefusal'] = null
  let attemptedQuote: ReviewFinding['attemptedQuote'] = null

  if (answer.quote) {
    const verified = verifyQuote(layer, answer.quote, answer.blockIndex)
    if (verified.ok) {
      citation = verified.citation
    } else {
      citationRefusal = verified.reason
      // Kept only on refusal: a verified citation already holds the text.
      attemptedQuote = answer.quote
    }
  }

  return {
    ruleNumber: rule.number,
    outcome,
    severity: outcome === 'deviation' || outcome === 'absent' ? rule.risk : null,
    rationale: answer.rationale ?? '',
    proposedLanguage: answer.proposedLanguage,
    citation,
    citationRefusal,
    attemptedQuote,
  }
}
```

6. In `runReviewPlaybook`, resolve the render and take everything from it. Keep the `no_text` guard first — a scan should be refused before anything else:

```ts
  // Resolved once, before any call: a run pinning a version this build does
  // not have should fail before spending a model call.
  const render = reviewRender(deps.renderVersion)

  const model = deps.model ?? 'claude-sonnet-5'
  const document = render.document(layer)
```

and inside `requestFor`:

```ts
          model,
          max_tokens: render.maxTokens,
          system: [
            { type: 'text', text: render.instructions },
            // Static prefix, cached. Everything that varies comes after it.
            { type: 'text', text: document, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: render.ruleMessage(rule) }],
          tools: [render.tool],
          tool_choice: { type: 'tool', name: render.tool.name },
```

with `toolName: render.tool.name` on the seams object and
`findingFor: (rule, input) => findingForRule(rule, render, input, layer)`.

- [ ] **Step 4: Run the tests, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/render-versions.test.ts
npm run test --workspace apps/workbench
npm run typecheck --workspace apps/workbench && npm run typecheck
git add -A packages/citations/src/review apps/workbench/tests
git commit -m "The review engine asks the run's own render

Same change as the field audit's, for the other kind. runReviewPlaybook
resolves one render from the run's pinned version and takes the instructions,
tool, tool name, max_tokens, rule wrapper and document format from it; the
module constants are gone. The parse moves into the render because shape is
what the schema decides, and verifyQuote stays in the engine because a fix to
the verifier must reach a run that opened before it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rename the column *(controller-only — not for a subagent)*

This task touches production credentials and the production database. **The session owner runs it, not an implementer subagent.** No subagent should be given the connection string, and nothing in this task may print, echo or log it.

**Files:**
- Create: `supabase/migrations/20261109000000_run_render_version.sql`
- Modify: `packages/db-types/src/supabase.generated.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- A run records which *render* produced it, not just which instruction text.
--
-- #424 added instructions_version, pinning the instruction text a run answers
-- against so that a retry weeks later asks the same question. That left four
-- pieces of the same question as un-versioned module code: the tool schema,
-- the tool name, the per-unit message wrapper, the input formatter and
-- max_tokens. All of them are read at the moment of the call, and the call can
-- come much later -- retryFailedSteps sets failed steps back to pending and
-- the next tick works them against whatever is deployed then.
--
-- So the versioned unit widens from the instruction text to the whole render:
-- everything the code contributes to a unit's call, as one object per version
-- per kind in packages/citations. A rename rather than a new column, because
-- every existing value is still correct -- version 1 of the render *is* the
-- render those runs used, with identical values. Nothing is guessed and
-- nothing is backfilled, the same discipline as #424's migration.
--
-- Versioned together rather than on separate axes because separate axes make
-- combinations representable that never ran -- instructions v1 with tool v3 --
-- and replay would construct them while reporting fidelity.
--
-- Still nullable, with the meaning unchanged: null means the run predates
-- versioning, and a retry renders the current entry, which is what it would
-- have got anyway. The null is what lets that be reasoned about rather than
-- discovered.
--
-- One column for both kinds. A render is per kind -- field_audit's is about
-- quoting design-sheet fields, review's about anchoring citations in a
-- document -- so `kind` and `render_version` together name one render, and a
-- run has exactly one kind.
--
-- What is deliberately NOT versioned: the gate. verifyFieldReference,
-- verifyQuote and the refusal of a finding with no references stay at current
-- code, because a run's question must not change after it opens while a run's
-- conclusion is allowed to improve. Versioning the gate would let a run opened
-- before a gate fix escape that fix on retry.

alter table public.workflow_runs
  rename column instructions_version to render_version;

comment on column public.workflow_runs.render_version is
  'Which entry of the per-kind render registry in packages/citations produced '
  'this run -- instructions, tool schema, tool name, max_tokens, message '
  'wrapper and input formatter together. Null means the run predates the '
  'registry, in which case a retry renders the current entry. Read with '
  '`kind`, which selects the registry.';

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it**

Apply through the pooler URL from the main checkout's `.env.local`, copied into the worktree only for the operation and removed immediately — including on failure, via `trap … EXIT INT TERM`. Never print, echo, log or interpolate the password, and put no connection string in any report. `--db-url` is the only route that works from a worktree.

- [ ] **Step 3: Verify from the catalog, not the migration history**

This project has had phantom rows in `supabase_migrations.schema_migrations`, so that table proves nothing. Confirm from `information_schema` instead:

```sql
select column_name, is_nullable, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'workflow_runs'
   and column_name in ('render_version', 'instructions_version');
```

Expected: exactly one row, `render_version | YES | integer`. Also confirm the values carried over:

```sql
select render_version, count(*) from public.workflow_runs group by 1 order by 1;
```

Expected: the same distribution `instructions_version` had before the rename — no nulls appearing where there were none.

- [ ] **Step 4: Regenerate the types**

Regenerate with `supabase gen types --db-url`, then **hand-restore the `__InternalSupabase: { PostgrestVersion: "14.5" }` block**, which the `--db-url` route drops and `tests/supabase-types-drift.test.ts` requires.

Confirm the generated file now says `render_version` and no longer says `instructions_version`:

```bash
grep -c 'render_version' packages/db-types/src/supabase.generated.ts
grep -c 'instructions_version' packages/db-types/src/supabase.generated.ts
```

Expected: 4 and 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109000000_run_render_version.sql packages/db-types/src/supabase.generated.ts
git commit -m "A run records which render produced it

Renames workflow_runs.instructions_version to render_version. A rename, not a
new column: version 1 of the render is exactly the render the existing rows
used, so every value is still correct and nothing is guessed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the workbench to the renamed column

**Files:**
- Modify: `apps/workbench/lib/runs/context.ts:32,53`
- Modify: `apps/workbench/lib/runs/record.ts:5-6,119-122`
- Modify: `apps/workbench/lib/runs/worker.ts:110,130`
- Modify: `apps/workbench/tests/run-worker.test.ts:82,156,174`

- [ ] **Step 1: Update the failing test first**

In `apps/workbench/tests/run-worker.test.ts`, change the fixture at line 82 from `instructions_version: 1,` to `render_version: 1,`, and at line 174 from `run: { ...context.run, instructions_version: 7 },` to `run: { ...context.run, render_version: 7 },`. Update the comment at line 156 to say `run.render_version`.

Then check what that case actually asserts. It must assert the engine *received* 7 — if it only asserts the run completed, it does not bite. If it is weak, strengthen it to capture the value the engine was handed:

```ts
expect(seenRenderVersion).toBe(7)
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/run-worker.test.ts
```

Expected: FAIL — `render_version` is not a property of the run context type, and `context.ts` still selects `instructions_version`.

- [ ] **Step 3: Rename at the three call sites**

`apps/workbench/lib/runs/context.ts` — line 32, the type:

```ts
  render_version: number | null
```

and line 53, the select list — replace `instructions_version` with `render_version`:

```ts
    .select('id, kind, prompt_version_id, matter_id, resolved_inputs, text_layer_id, document_version_id, model, render_version')
```

`apps/workbench/lib/runs/record.ts` — the imports at lines 5-6:

```ts
import { CURRENT_FIELD_AUDIT_RENDER_VERSION } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { CURRENT_REVIEW_RENDER_VERSION } from '@aubrey-law/citations/review/runReview'
```

and the insert at lines 119-122:

```ts
      // Which render this run is answering against. Stamped now, so a retry
      // weeks later builds the same call rather than whatever is deployed
      // then — the other half of what pinning prompt_version_id is for. Per
      // kind, because the two registries hold different contracts.
      render_version:
        input.kind === 'field_audit'
          ? CURRENT_FIELD_AUDIT_RENDER_VERSION
          : CURRENT_REVIEW_RENDER_VERSION,
```

`apps/workbench/lib/runs/worker.ts` — line 110, in the field-audit branch:

```ts
          // The run's own pinned render, not the deployed constant.
          renderVersion: run.render_version,
```

and line 130, in the review branch:

```ts
          renderVersion: run.render_version,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test --workspace apps/workbench
```

Expected: PASS, whole workbench suite.

- [ ] **Step 5: Confirm nothing still refers to the old name**

```bash
grep -rn 'instructions_version\|instructionsVersion\|INSTRUCTIONS_VERSION' --include='*.ts' --include='*.tsx' . 2>/dev/null | grep -v node_modules
```

Expected: **no output** except the historical migration `20261108000000_run_instructions_version.sql`, which stays exactly as it is — an applied migration is a record of what happened and is never edited.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck --workspace apps/workbench && npm run typecheck
git add -A apps/workbench
git commit -m "The workbench stamps and forwards render_version

openRun stamps the current render version per kind, workRun reads the run's own
and hands it to the engine, and the run context type and select list follow the
column. The run-worker case that proves a pinned version reaches the engine now
pins 7 and asserts the engine saw 7, rather than only that the run finished.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-suite check and the record

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-workbench-overhaul.md` (phase 4's "Still owed" paragraph)

- [ ] **Step 1: Run both suites and both typechecks**

```bash
npm run typecheck --workspace apps/workbench && npm run typecheck
npm run test --workspace apps/workbench
npm test
```

The root suite is large. If it reports `Failed to start forks worker` or takes implausibly long, check `uptime` — this machine has hit load average 246 with memory pressure, and that failure mode is the machine, not the code. Re-run when load is normal rather than "fixing" a test.

- [ ] **Step 2: Update phase 4's "Still owed" paragraph**

In `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, phase 4's *Still owed* paragraph currently says `FIELD_AUDIT_TOOL`'s `input_schema` is un-versioned code and that the same argument as #424 applies to it. Replace that sentence with one saying it was versioned — and widen, since the whole render moved:

```
The tool schema was the named gap and is now closed: the versioned unit is the
whole render — instructions, tool schema and name, `max_tokens`, the message
wrapper and the input formatter — pinned on `workflow_runs.render_version`,
with the gate deliberately left at current code so a fix to it still reaches a
run that opened before it. What that leaves un-versioned is `runPrompt`'s loop:
retry counts, concurrency and where the cache breakpoint sits. Those shape cost
and latency rather than the question asked, which is why they were left, and
naming them is how that stays a decision.
```

Keep the rest of the paragraph — #419 and #421 being test-only, the three unexercised fiduciary kinds, and the drafting-notes measurement — unchanged.

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/plans/2026-09-02-workbench-overhaul.md
git commit -m "Phase 4's named gap is closed

The tool schema was listed as un-versioned code that shapes what the model can
answer, with the note that #424's argument applied to it. It is versioned now,
and wider than named: the whole render. The paragraph says what that left out
-- runPrompt's loop -- so the remaining omission reads as a decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin claude/tool-schema-version-2
```

---

## Verification against the design

| Spec requirement | Task |
| --- | --- |
| `FieldAuditRender` type and registry | 1 |
| Version 1 identical to today | 1 (two equality tests), 3 |
| Model id stays out of the render | 1 (documented), 2 (engine keeps `deps.model`) |
| Tool name inside the render | 1, 3 (`toolName: render.tool.name` in 2, 4) |
| `parse` in the render, gate in the engine | 2, 4 |
| `ParsedFieldAuditAnswer.outcome` unvalidated | 1, 2 |
| `ReviewRender` and its engine | 3, 4 |
| Column rename + comment | 5 |
| Types regenerated with the restored header | 5 |
| `renderVersion` on both engines' inputs | 2, 4 |
| Stamp / select / forward | 6 |
| Synthetic v2 divergence tests | 2, 4 |
| Gate ignores the version | 2, 4 |
| Exported tool name tracks current | 2, 3 |
| Unknown version throws before a call | 1, 2, 3, 4 |
| Null falls back to current | 1, 3 |
| The false `report_field_audit_finding` fixture | 2 |
