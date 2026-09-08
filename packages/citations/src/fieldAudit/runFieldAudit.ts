import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { FieldAuditBody, FieldAuditCheck } from '../prompt/body'
import { runPrompt, type RunPromptDependencies } from '../prompt/runPrompt'
import type { ModelCaller, ModelRequest } from '../review/model'
import { collectLeaves, verifyFieldReference } from './verify'
import type { FieldAuditFinding, FieldAuditResult, FieldReference } from './types'

export const FIELD_AUDIT_TOOL_NAME = 'report_check'

/**
 * Forced tool use, not free text — the same reasoning as REVIEW_TOOL in
 * runReview.ts: a strict `input_schema` with `tool_choice` pinned to this
 * tool makes the response shape the model's problem, not a regex's.
 */
export const FIELD_AUDIT_TOOL = {
  name: FIELD_AUDIT_TOOL_NAME,
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

const SYSTEM_INSTRUCTIONS = `
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

export interface FieldAuditContext {
  promptSlug: string
  promptVersion: number
  values: Record<string, unknown>
  matterId?: string | null
  userId?: string | null
}

export interface RunFieldAuditDependencies {
  /**
   * Required, not defaulted — see ./model in the review package for why: a
   * package that silently falls back to one app's client forks retry
   * behaviour and usage accounting without anything saying so.
   */
  callModel: ModelCaller
  model?: string
  /** Forwarded straight through to `runPrompt` — see its own doc comment. */
  onUnitSettled?: RunPromptDependencies['onUnitSettled']
}

function formatFieldValue(key: string, value: unknown): string {
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

function sheetForPrompt(values: Record<string, unknown>): string {
  // Field keys are what the model references with, and they have to be the
  // keys `verifyFieldReference` looks up — otherwise the label is noise and
  // every claim fails for citing a key the sheet never showed.
  const lines = Object.entries(values)
    .map(([key, value]) => `[field: ${key}]\n${formatFieldValue(key, value)}`)
    .join('\n\n')
  return quoteUserContent('design_sheet', lines)
}

function checkMessage(check: FieldAuditCheck): string {
  const lines = [
    `Check ${check.number}: ${check.statement}`,
    '',
    `Fields you may reference: ${check.reads.join(', ')}`,
    '',
    `Report your conclusion for this check only, using the ${FIELD_AUDIT_TOOL_NAME} tool.`,
  ]
  return lines.join('\n')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Turns one check's tool input into a finding, verifying every claimed
 * reference against `values` on the way. Throws for an input `runPrompt`
 * should record as a failure rather than a finding — here, only an outcome
 * the tool schema does not actually allow through — so the specific reason
 * travels with it.
 */
function findingForCheck(
  check: FieldAuditCheck,
  input: Record<string, unknown>,
  values: Record<string, unknown>,
): FieldAuditFinding {
  const outcome = input.outcome
  if (
    outcome !== 'compliant' &&
    outcome !== 'deviation' &&
    outcome !== 'absent' &&
    outcome !== 'not_applicable'
  ) {
    throw new Error(`Unrecognised outcome ${String(outcome)}`)
  }

  const rawReferences = Array.isArray(input.references) ? input.references : []
  const references: FieldReference[] = rawReferences
    .filter((ref): ref is Record<string, unknown> => ref !== null && typeof ref === 'object')
    .map(ref =>
      verifyFieldReference(values, check.reads, {
        fieldKey: asString(ref.field_key) ?? '',
        claimedValue: asString(ref.claimed_value),
      }),
    )
    .filter(ref => ref.fieldKey !== '')

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
    rationale: asString(input.rationale) ?? '',
    references,
  }
}

/**
 * Runs one prompt's checks against one matter's design-sheet values and
 * returns findings whose field references have been checked against the
 * values themselves.
 *
 * The verification step is the whole point, exactly as in runReview.ts: what
 * a check claims a field holds is a *claim* until `verifyFieldReference` finds
 * it there. A finding whose reference cannot be verified keeps its rationale
 * — it may still be worth a person's attention — but the reference itself
 * records the mismatch rather than pretending to support it.
 *
 * Checks run in the prompt's order against one cached sheet. The cache
 * breakpoint marks a prefix, so the sheet sits in the system array ahead of
 * the varying check: forty checks over one sheet is one cache write and
 * thirty-nine reads. As in review, this is why an audit is run contiguously
 * rather than interleaved with other work — the five-minute TTL is what pays
 * for the shared prefix.
 *
 * The loop itself lives in ../prompt/runPrompt — this function supplies the
 * three things that differ from a review's: what a unit (a check) is, what
 * its request says, and what its response becomes.
 */
export async function runFieldAudit(
  context: FieldAuditContext,
  body: FieldAuditBody,
  deps: RunFieldAuditDependencies,
): Promise<FieldAuditResult> {
  const model = deps.model ?? 'claude-sonnet-5'
  const sheet = sheetForPrompt(context.values)

  const run = await runPrompt<FieldAuditCheck, FieldAuditFinding>(
    {
      units: body.checks,
      toolName: FIELD_AUDIT_TOOL_NAME,
      idFor: check => check.number,
      requestFor: check =>
        ({
          model,
          max_tokens: 1024,
          system: [
            { type: 'text', text: SYSTEM_INSTRUCTIONS },
            // Static prefix, cached. Everything that varies comes after it.
            { type: 'text', text: sheet, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: checkMessage(check) }],
          tools: [FIELD_AUDIT_TOOL],
          tool_choice: { type: 'tool', name: FIELD_AUDIT_TOOL_NAME },
        }) as ModelRequest,
      findingFor: (check, input) => findingForCheck(check, input, context.values),
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

/**
 * Whether one finding may act.
 *
 * Extracted from `actionableFindings` so the withdrawal rule in
 * `apps/workbench/lib/fieldAudit/tasks.ts` can ask the same question from the
 * other side without carrying its own copy of the answer. Two copies could
 * disagree, and the shape of that disagreement is a finding that is refused as
 * unverifiable *and* counted as grounds for withdrawing an earlier one — which
 * is the defect this slice exists to remove.
 */
export function isActionable(finding: FieldAuditFinding): boolean {
  return (
    (finding.outcome === 'deviation' || finding.outcome === 'absent') &&
    finding.references.some(reference => reference.verification === 'verified')
  )
}

/**
 * The findings that may act on anything — surface as a task, drive a
 * decision.
 *
 * One gate rather than a filter repeated at each call site, mirroring
 * `exportableFindings` in runReview.ts. A `compliant` or `not_applicable`
 * finding never needed to prove anything, so it is excluded regardless of its
 * references.
 *
 * **This is not the verifier, and the verifier has not moved.** An unverified
 * claim is still refused as evidence, still stored with what the field
 * actually held, and still counted in the rate this design is judged by. What
 * this decides is different: how much checked support a finding needs before
 * it is worth a person's time.
 *
 * It required *every* reference to verify, and that was too strict once a
 * finding could carry several. Three runs of the same six checks against the
 * same matter verified 19, 18 and 17 of 19 references — the outcomes identical
 * every time, the drift always on the jsonb array fields (`children`,
 * `assets`) where a model phrases a claim differently run to run. Under the old
 * rule a blocker — "a person named in the notes is missing from the plan" —
 * had three of its four references check out and produced no task at all. A
 * finding supported three ways out of four is not an unsupported claim, and
 * dropping it silently is the worse error: the attorney never learns it was
 * found.
 *
 * So: at least one verified reference. The unverified ones travel with the
 * finding and the run view shows each one's status, so what a task rests on
 * stays visible rather than being averaged away.
 *
 * Owner's decision, 2026-09-06, after the rate was measured across those three
 * runs.
 */
export function actionableFindings(result: FieldAuditResult): FieldAuditFinding[] {
  return result.findings.filter(isActionable)
}

/**
 * What a run concluded about one check.
 *
 * `cleared` and `inconclusive` both produce no task, which is exactly why they
 * need distinguishing: `cleared` is the run saying it looked and the check is
 * fine, and `inconclusive` is the run seeing a problem it cannot cite, or not
 * answering at all. Only the first is grounds for retiring someone's task.
 */
export type CheckAnswer = 'cleared' | 'actionable' | 'inconclusive'

export function answerForFinding(
  finding: FieldAuditFinding | undefined,
  unitSucceeded: boolean,
): CheckAnswer {
  // A unit that failed did not answer, whatever finding an earlier attempt
  // left behind — so it can retire nothing.
  if (!unitSucceeded) return 'inconclusive'
  if (!finding) return 'inconclusive'
  if (finding.outcome === 'compliant' || finding.outcome === 'not_applicable') return 'cleared'
  return isActionable(finding) ? 'actionable' : 'inconclusive'
}

export interface RunAnswers {
  /** Every check number the run's prompt version declares, mapped to its answer. */
  byCheck: Record<string, CheckAnswer>
  /**
   * Every check came back `cleared` or `actionable`. A complete answer may
   * retire prior work; a partial one may only add to it.
   */
  authoritative: boolean
}

export function runAnswers(input: {
  checkNumbers: string[]
  /** *All* of the run's findings, not `actionableFindings` — the withdrawal
   *  decision needs the outcomes the gate discards. */
  findings: FieldAuditFinding[]
  /** Units whose step did not succeed. */
  failedCheckNumbers: string[]
}): RunAnswers {
  const findingByCheck = new Map(input.findings.map(finding => [finding.checkNumber, finding]))
  const failed = new Set(input.failedCheckNumbers)

  const byCheck: Record<string, CheckAnswer> = {}
  for (const checkNumber of input.checkNumbers) {
    byCheck[checkNumber] = answerForFinding(findingByCheck.get(checkNumber), !failed.has(checkNumber))
  }

  return {
    byCheck,
    // A prompt with no checks is not a complete answer to anything, and
    // `every` on an empty list would call it one.
    authoritative:
      input.checkNumbers.length > 0 &&
      input.checkNumbers.every(checkNumber => byCheck[checkNumber] !== 'inconclusive'),
  }
}
