import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import { runPrompt, type RunPromptDependencies } from '../prompt/runPrompt'
import { verifyQuote } from '../textLayer/match'
import type { TextLayer } from '../textLayer/types'
import type { ModelCaller, ModelRequest } from './model'
import type { ReviewFinding, ReviewPlaybook, ReviewResult, ReviewRule } from './types'

export const REVIEW_TOOL_NAME = 'report_finding'

/**
 * Forced tool use, not free text.
 *
 * The route this replaces asks for JSON in prose and then runs
 * `raw.match(/\[[\s\S]*\]/)` over the reply — which parses a model's
 * conversational aside as data whenever it happens to contain a bracket. A
 * strict `input_schema` with `tool_choice` pinned to this tool makes the shape
 * the model's problem instead of the parser's.
 */
export const REVIEW_TOOL = {
  name: REVIEW_TOOL_NAME,
  description:
    'Report the conclusion for exactly one rule against the document under review.',
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

/**
 * Every version of the review instructions, keyed by the number a run pins in
 * `workflow_runs.instructions_version`. See
 * `../fieldAudit/runFieldAudit.ts`'s registry for why old strings stay here
 * and why earlier variants are not reconstructed.
 *
 * A separate registry from the field audit's because the instructions are per
 * kind: these are about anchoring a citation in a document, those are about
 * quoting a design-sheet field. `workflow_runs.kind` and
 * `instructions_version` together name one text.
 */
export const REVIEW_INSTRUCTIONS: Record<number, string> = {
  1: `
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
`.trim(),
}

/** What `openRun` stamps on a new review run. */
export const CURRENT_REVIEW_INSTRUCTIONS_VERSION = 1

export function reviewInstructions(version: number | null | undefined): string {
  if (version == null) return REVIEW_INSTRUCTIONS[CURRENT_REVIEW_INSTRUCTIONS_VERSION]
  const text = REVIEW_INSTRUCTIONS[version]
  if (!text) {
    throw new Error(
      `No review instructions recorded for version ${version}. ` +
        'A run cannot be finished against instructions this build does not have.',
    )
  }
  return text
}

export interface RunReviewDependencies {
  /**
   * Which instruction text to render, from
   * `workflow_runs.instructions_version`. Null for a run made before the
   * instructions were versioned.
   */
  instructionsVersion?: number | null
  /**
   * Required, not defaulted. See ./model — a package that falls back to one
   * app's client forks their retry behaviour and usage accounting silently.
   */
  callModel: ModelCaller
  model?: string
  matterId?: string | null
  userId?: string | null
  /** Forwarded straight through to `runPrompt` — see its own doc comment. */
  onUnitSettled?: RunPromptDependencies['onUnitSettled']
}

function documentForPrompt(layer: TextLayer): string {
  // Paragraph numbers are what the model cites with, and they have to be the
  // block indexes the verifier scopes by — otherwise the hint is noise and
  // every quote falls back to a whole-document search.
  const numbered = layer.blocks.map(block => `[¶ ${block.index}] ${block.text}`).join('\n\n')
  return quoteUserContent('document_under_review', numbered)
}

function ruleMessage(rule: ReviewRule): string {
  const lines = [`Rule ${rule.number}: ${rule.statement}`]
  if (rule.preferredLanguage) {
    lines.push('', `The firm's preferred language for this point:`, rule.preferredLanguage)
  }
  lines.push('', `Report your conclusion for this rule only, using the ${REVIEW_TOOL_NAME} tool.`)
  return lines.join('\n')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Turns one rule's tool input into a finding, verifying its quote against
 * `layer` on the way. Throws for an input `runPrompt` should record as a
 * failure rather than a finding — here, only an outcome the tool schema does
 * not actually allow through — so the specific reason travels with it.
 */
function findingForRule(rule: ReviewRule, input: Record<string, unknown>, layer: TextLayer): ReviewFinding {
  const outcome = input.outcome
  if (
    outcome !== 'compliant' &&
    outcome !== 'deviation' &&
    outcome !== 'absent' &&
    outcome !== 'not_applicable'
  ) {
    throw new Error(`Unrecognised outcome ${String(outcome)}`)
  }

  const quote = asString(input.quote)
  const blockIndex = typeof input.block_index === 'number' ? input.block_index : null

  let citation: ReviewFinding['citation'] = null
  let citationRefusal: ReviewFinding['citationRefusal'] = null
  let attemptedQuote: ReviewFinding['attemptedQuote'] = null

  if (quote) {
    const verified = verifyQuote(layer, quote, blockIndex)
    if (verified.ok) {
      citation = verified.citation
    } else {
      citationRefusal = verified.reason
      // Kept only on refusal: a verified citation already holds the text.
      attemptedQuote = quote
    }
  }

  return {
    ruleNumber: rule.number,
    outcome,
    severity: outcome === 'deviation' || outcome === 'absent' ? rule.risk : null,
    rationale: asString(input.rationale) ?? '',
    proposedLanguage: asString(input.proposed_language),
    citation,
    citationRefusal,
    attemptedQuote,
  }
}

/**
 * Runs one playbook against one document and returns findings whose citations
 * have been checked against the document itself.
 *
 * The verification step is the whole point, and it is unconditional: a quote
 * the model produced is a *claim* about the document until this function finds
 * it there, exactly once. A finding whose quote cannot be verified keeps its
 * rationale — it may still be worth a person's attention — but carries no
 * citation and is excluded from anything that marks up the document.
 *
 * Steps run in playbook order against one cached document. The cache breakpoint
 * marks a prefix, so the document sits in the system array ahead of the varying
 * rule: forty rules over one instrument is one cache write and thirty-nine
 * reads. The five-minute TTL is why a review is run contiguously rather than
 * interleaved with other work.
 *
 * The loop itself lives in ../prompt/runPrompt — this function supplies the
 * three things that differ from a field audit's: what a unit (a rule) is,
 * what its request says, and what its response becomes.
 */
export async function runReviewPlaybook(
  layer: TextLayer,
  playbook: ReviewPlaybook,
  deps: RunReviewDependencies,
): Promise<ReviewResult> {
  if (layer.status === 'no_text') {
    throw new Error(
      'This document has no text layer — it is most likely a scan. Reviewing it would produce findings about nothing; supply a text PDF or the DOCX instead.',
    )
  }

  // Resolved once, before any call: a run pinning a version this build does
  // not have should fail before spending a model call.
  const instructions = reviewInstructions(deps.instructionsVersion)

  const model = deps.model ?? 'claude-sonnet-5'
  const document = documentForPrompt(layer)

  const run = await runPrompt<ReviewRule, ReviewFinding>(
    {
      units: playbook.rules,
      toolName: REVIEW_TOOL_NAME,
      idFor: rule => rule.number,
      requestFor: rule =>
        ({
          model,
          max_tokens: 1024,
          system: [
            { type: 'text', text: instructions },
            // Static prefix, cached. Everything that varies comes after it.
            { type: 'text', text: document, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: ruleMessage(rule) }],
          tools: [REVIEW_TOOL],
          tool_choice: { type: 'tool', name: REVIEW_TOOL_NAME },
        }) as ModelRequest,
      findingFor: (rule, input) => findingForRule(rule, input, layer),
    },
    {
      callModel: deps.callModel,
      context: {
        route: 'review/playbook',
        matterId: deps.matterId ?? null,
        userId: deps.userId ?? null,
        contextType: 'matter',
      },
      onUnitSettled: deps.onUnitSettled,
    },
  )

  return {
    playbookSlug: playbook.slug,
    playbookVersion: playbook.version,
    findings: run.findings,
    failures: run.failures.map(failure => ({ ruleNumber: failure.unitId, reason: failure.reason })),
  }
}

/**
 * The findings that may be exported.
 *
 * A single gate rather than a filter repeated at each call site, because "only
 * verified citations reach a client-facing artifact" is the rule the whole
 * design rests on and it should be enforceable in one place.
 */
export function exportableFindings(result: ReviewResult): ReviewFinding[] {
  return result.findings.filter(
    finding =>
      finding.outcome === 'deviation' &&
      finding.citation !== null &&
      finding.citation.verification === 'verified' &&
      finding.proposedLanguage !== null,
  )
}
