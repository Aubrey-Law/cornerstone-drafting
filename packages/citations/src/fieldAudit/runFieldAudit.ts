import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { FieldAuditBody, FieldAuditCheck } from '../prompt/body'
import type { ModelCaller, ModelRequest, ModelResponse } from '../review/model'
import { verifyFieldReference } from './verify'
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
- Report what the sheet records, not what you would prefer it recorded.
- If the sheet is silent on the point, the outcome is "absent" — reference the
  field with a null claimed_value rather than referencing something adjacent.
- Do not report a deviation or an absence you cannot reference. An unsupported
  finding is worse than a missed one.

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
}

interface ToolInput {
  outcome: unknown
  rationale: unknown
  references: unknown
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function sheetForPrompt(values: Record<string, unknown>): string {
  // Field keys are what the model references with, and they have to be the
  // keys `verifyFieldReference` looks up — otherwise the label is noise and
  // every claim fails for citing a key the sheet never showed.
  const lines = Object.entries(values)
    .map(([key, value]) => `[field: ${key}] ${formatFieldValue(value)}`)
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

function readToolInput(response: ModelResponse): ToolInput | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === FIELD_AUDIT_TOOL_NAME) {
      return block.input as ToolInput
    }
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
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
 */
export async function runFieldAudit(
  context: FieldAuditContext,
  body: FieldAuditBody,
  deps: RunFieldAuditDependencies,
): Promise<FieldAuditResult> {
  const call = deps.callModel
  const model = deps.model ?? 'claude-sonnet-5'
  const sheet = sheetForPrompt(context.values)

  const findings: FieldAuditFinding[] = []
  const failures: FieldAuditResult['failures'] = []

  for (const check of body.checks) {
    let input: ToolInput | null
    try {
      const response = await call(
        {
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
        } as ModelRequest,
        {
          route: 'field_audit/prompt',
          matterId: context.matterId ?? null,
          userId: context.userId ?? null,
          contextType: 'matter',
        },
      )
      input = readToolInput(response)
    } catch (error) {
      // Per-check fail-soft: one check losing its call must not cost the audit.
      failures.push({ checkNumber: check.number, reason: (error as Error).message })
      continue
    }

    if (!input) {
      failures.push({ checkNumber: check.number, reason: 'Model returned no tool call' })
      continue
    }

    const outcome = input.outcome
    if (
      outcome !== 'compliant' &&
      outcome !== 'deviation' &&
      outcome !== 'absent' &&
      outcome !== 'not_applicable'
    ) {
      failures.push({ checkNumber: check.number, reason: `Unrecognised outcome ${String(outcome)}` })
      continue
    }

    const rawReferences = Array.isArray(input.references) ? input.references : []
    const references: FieldReference[] = rawReferences
      .filter((ref): ref is Record<string, unknown> => ref !== null && typeof ref === 'object')
      .map(ref =>
        verifyFieldReference(context.values, check.reads, {
          fieldKey: asString(ref.field_key) ?? '',
          claimedValue: asString(ref.claimed_value),
        }),
      )
      .filter(ref => ref.fieldKey !== '')

    findings.push({
      checkNumber: check.number,
      outcome,
      severity: outcome === 'deviation' || outcome === 'absent' ? check.risk : null,
      rationale: asString(input.rationale) ?? '',
      references,
    })
  }

  return {
    promptSlug: context.promptSlug,
    promptVersion: context.promptVersion,
    findings,
    failures,
  }
}

/**
 * The findings that may act on anything — surface as a task, drive a
 * decision.
 *
 * One gate rather than a filter repeated at each call site, mirroring
 * `exportableFindings` in runReview.ts: "only verified evidence leaves the
 * tool" is the rule everything here rests on, and a finding needs at least
 * one reference and every one of them verified before it qualifies. A
 * `compliant` or `not_applicable` finding never needed to prove anything, so
 * it is excluded regardless of its references.
 */
export function actionableFindings(result: FieldAuditResult): FieldAuditFinding[] {
  return result.findings.filter(
    finding =>
      (finding.outcome === 'deviation' || finding.outcome === 'absent') &&
      finding.references.length > 0 &&
      finding.references.every(reference => reference.verification === 'verified'),
  )
}
