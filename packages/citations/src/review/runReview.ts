import { runPrompt, type RunPromptDependencies } from '../prompt/runPrompt'
import { verifyQuote } from '../textLayer/match'
import type { TextLayer } from '../textLayer/types'
import type { ModelCaller, ModelRequest } from './model'
import { reviewRender, type ReviewRender } from './render'
import type { ReviewFinding, ReviewPlaybook, ReviewResult, ReviewRule } from './types'
import { evaluateConditions, type MatterFacts } from './conditions'

export {
  CURRENT_REVIEW_RENDER_VERSION,
  REVIEW_RENDERS,
  REVIEW_TOOL_NAME,
  reviewRender,
} from './render'
export type { ReviewRender, ParsedReviewAnswer } from './render'

export interface RunReviewDependencies {
  /**
   * Which render to use, from `workflow_runs.render_version`. Null for a run
   * made before the render was versioned.
   */
  renderVersion?: number | null
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
  /**
   * The matter's facts, as pinned on the run. With none — an uploaded draft,
   * or a matter with no design sheet — every rule runs, conditions or not.
   */
  matterFacts?: MatterFacts | null
}

/**
 * Turns one rule's parsed answer into a finding, verifying its quote against
 * `layer` on the way. Throws for an answer `runPrompt` should record as a
 * failure rather than a finding, so the specific reason travels with it.
 *
 * The tool input's shape is the render's business (see `render.ts`);
 * verification is not, and is never versioned — a fix to the verifier must
 * reach a run that opened before it. `outcome` arrives unvalidated for the
 * same reason: a later schema offering a fifth outcome must still be refused
 * by a build that does not know it.
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
  const render = reviewRender(deps.renderVersion)

  const model = deps.model ?? 'claude-sonnet-5'
  const document = render.document(layer)

  // Rules the matter's facts rule out are answered here, without a model
  // call, as `not_applicable` with the reason on the finding — recorded, never
  // silently dropped, so a reader can see a rule was skipped and why.
  const skipped = new Map<string, ReviewFinding>()
  for (const rule of playbook.rules) {
    const evaluation = evaluateConditions(rule.conditions, deps.matterFacts ?? null)
    if (evaluation.status !== 'not_met') continue
    skipped.set(rule.number, {
      ruleNumber: rule.number,
      outcome: 'not_applicable',
      severity: null,
      rationale: evaluation.reason,
      proposedLanguage: null,
      citation: null,
      citationRefusal: null,
      attemptedQuote: null,
    })
  }
  for (const ruleNumber of skipped.keys()) {
    if (!deps.onUnitSettled) break
    try {
      await deps.onUnitSettled(ruleNumber, { ok: true })
    } catch {
      // As in runPrompt: the step row is the record of the work, not the work.
    }
  }

  const run = await runPrompt<ReviewRule, ReviewFinding>(
    {
      units: playbook.rules.filter(rule => !skipped.has(rule.number)),
      toolName: render.tool.name,
      idFor: rule => rule.number,
      requestFor: rule =>
        ({
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
        }) as ModelRequest,
      findingFor: (rule, input) => findingForRule(rule, render, input, layer),
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

  // Playbook order, skipped rules in their own places.
  const byRule = new Map(run.findings.map(finding => [finding.ruleNumber, finding]))
  const findings = playbook.rules.flatMap(rule => {
    const finding = skipped.get(rule.number) ?? byRule.get(rule.number)
    return finding ? [finding] : []
  })

  return {
    playbookSlug: playbook.slug,
    playbookVersion: playbook.version,
    findings,
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
