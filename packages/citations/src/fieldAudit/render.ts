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
