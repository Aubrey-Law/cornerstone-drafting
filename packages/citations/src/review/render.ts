import type Anthropic from '@anthropic-ai/sdk'
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { TextLayer } from '../textLayer/types'
import type { ReviewRule } from './types'

/**
 * What a model was actually asked, minus the document.
 *
 * See `../fieldAudit/render.ts` for the full argument: `workflow_runs` pins
 * the *data* half of a unit's call (immutable rules via `prompt_version_id`,
 * the text layer, the model), this is the half the code contributes, and it is
 * versioned as one object per version rather than per piece — separate axes
 * make combinations representable that never ran, and replay would construct
 * them while reporting fidelity.
 *
 * A separate registry from the field audit's, because a render is per kind:
 * these instructions are about anchoring a citation in a document, those about
 * quoting a design-sheet field. `workflow_runs.kind` and `render_version`
 * together name one render.
 *
 * The tool *name* belongs here and that is easy to miss: `runPrompt`'s
 * `readToolInput` matches the response block by name, so a version that
 * renames the tool and leaves the matcher behind reads nothing from every unit
 * and fails the run for a reason that looks like a model problem.
 *
 * **The model id is deliberately not here.** It is pinned per run on
 * `workflow_runs.model`; a second home for it could disagree with the first.
 *
 * **The gate is deliberately not here either** — see the note on `parse`. Nor
 * are the two shared prompt imports, for the gate's reason rather than by
 * oversight: `PROMPT_INJECTION_GUARDRAIL` is interpolated into version 1's
 * instruction text and `quoteUserContent` wraps the document block, and both
 * are injection defences whose hardening has to reach a run that opened before
 * it, exactly like the quote verifier.
 *
 * The fields are `readonly`: an entry is the record of what some run was
 * asked, so nothing may reassign one afterwards. `REVIEW_RENDERS` itself stays
 * writable, because a test needs to add an entry.
 */
export interface ReviewRender {
  readonly instructions: string
  /**
   * The SDK's own tool type, not a loose shape. This is the one field a new
   * version is most likely to get subtly wrong — an omitted `type: 'object'`
   * or a misspelt `properties` would typecheck against a
   * `Record<string, unknown>` schema, pass every registry test, and then fail
   * per-unit at the API in the middle of a run.
   */
  readonly tool: Anthropic.Tool
  readonly maxTokens: number
  /** How one rule's user message is worded. */
  readonly ruleMessage: (rule: ReviewRule) => string
  /** How the document block is built from the text layer. */
  readonly document: (layer: TextLayer) => string
  /**
   * Reads this version's tool input into a claim about the document.
   *
   * Only shape lives here, because shape is what the schema decides: if a
   * later version renames `block_index`, its parser moves with it. What must
   * *not* live here is the gate — `verifyQuote` against the layer, and the
   * decision about what a finding may support. A run's question must not
   * change after it opens; a run's conclusion is allowed to improve.
   * Versioning the gate would let a run opened before a verifier fix escape
   * that fix on retry.
   *
   * Validating `outcome` is also the engine's job, not this one's: it asks
   * whether an answer is answerable at all, and a v2 schema offering a fifth
   * outcome should still be refused by a build that does not know it. So
   * `outcome` comes back unvalidated.
   */
  readonly parse: (input: Record<string, unknown>) => ParsedReviewAnswer
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
    type: 'object',
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
 * `workflow_runs.render_version`.
 *
 * Old entries stay here rather than in git history, because replay is the
 * point: a run pinning version 1 must still be answerable when version 4 is
 * current. The file gets longer, which is the price of the property.
 *
 * Version 1 holds the values as they stood when the instructions alone were
 * versioned in #424 — copied verbatim, so nothing about a run's question
 * changed when this widened. See `../fieldAudit/render.ts`'s registry for why
 * earlier instruction variants are not reconstructed and why a run carrying a
 * null falls back to the current entry.
 *
 * The `V1` suffix names the version that *introduced* a piece, not the only
 * version that uses it — so a version 2 entry reading `document: documentV1`
 * is correct and expected, and says the document format has not changed since
 * version 1. A piece is never edited in place: editing `documentV1` would
 * retroactively rewrite what version 1 rendered, so divergence means a new
 * constant with the new version's suffix, referenced from that entry on.
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
 * The tool name of the *current* render.
 *
 * Derived rather than declared, so it cannot drift from the registry. Tests
 * build mock `tool_use` blocks with it; a run resolves its own version's name
 * from its own entry.
 */
export const REVIEW_TOOL_NAME = REVIEW_RENDERS[CURRENT_REVIEW_RENDER_VERSION].tool.name

/**
 * The render a run pinned. A null version means the run predates versioning,
 * so it gets the current entry — the behaviour it would have had regardless.
 *
 * An unknown *number* is a hard error rather than a fallback. A run pinning a
 * version this registry has lost is a run nobody can honestly finish, and
 * quietly substituting a different render would answer a different question
 * while reporting the run's own version.
 */
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
