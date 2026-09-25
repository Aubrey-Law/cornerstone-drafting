import { z } from 'zod'
import type { Citation } from '../textLayer/types'
import type { VerifyReason } from '../textLayer/match'
import { ruleConditionSchema } from './conditions'

/**
 * A review playbook: firm positions, each stated as one rule, checked one at a
 * time against a document.
 *
 * One rule per model call, deliberately. Asking for all of them at once trades
 * a large quality loss for a small cost saving — rules interfere, the weaker
 * ones get skipped, and there is no way to tell a rule that found nothing from
 * a rule that was never really considered. Separate calls also make per-rule
 * failure survivable: one bad response loses one rule, not the review.
 */
export const reviewRuleSchema = z.object({
  number: z.string().min(1),
  statement: z.string().min(1),
  risk: z.enum(['blocker', 'high', 'medium', 'low']),
  /** The firm's language, when it has settled wording for this point. */
  preferredLanguage: z.string().optional(),
  /**
   * When the rule applies, in matter facts — all must hold. Absent means
   * always. See ./conditions for why only a definite "no" skips a rule.
   * Optional so every body published before conditions existed still parses
   * (and still hashes) exactly as it did.
   */
  conditions: z.array(ruleConditionSchema).optional(),
})

export const reviewPlaybookSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  rules: z.array(reviewRuleSchema).min(1),
})

export type ReviewRule = z.infer<typeof reviewRuleSchema>
export type ReviewPlaybook = z.infer<typeof reviewPlaybookSchema>

/**
 * What a rule concluded.
 *
 * `absent` is separate from `compliant` because absence is the finding a review
 * exists to catch. "The indemnity must be mutual" is answered by the document
 * *not* saying something, and collapsing that into "no deviation found" is how
 * a review misses the thing that mattered.
 */
export type FindingOutcome = 'compliant' | 'deviation' | 'absent' | 'not_applicable'

export interface ReviewFinding {
  ruleNumber: string
  outcome: FindingOutcome
  severity: ReviewRule['risk'] | null
  rationale: string
  proposedLanguage: string | null
  /** Present only when the model's quote was verified against the document. */
  citation: Citation | null
  /** Why no citation, when there is none. Null when one was expected and found. */
  citationRefusal: VerifyReason | null
  /**
   * The words the model tried to quote, kept only when they could not be
   * verified.
   *
   * The share of citations that survive verification is the measure this whole
   * design is judged by, and the response to a poor one is to change the
   * prompting or how the document is presented — never to loosen the verifier.
   * Neither can be decided without seeing what the model actually reached for.
   */
  attemptedQuote: string | null
}

export interface ReviewResult {
  playbookSlug: string
  playbookVersion: number
  findings: ReviewFinding[]
  /** Rules whose model call failed outright. The review continues without them. */
  failures: Array<{ ruleNumber: string; reason: string }>
}
