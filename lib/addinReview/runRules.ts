import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { MatterFacts } from '@aubrey-law/citations/review/conditions'
import type { ReviewFinding, ReviewPlaybook, ReviewRule } from '@aubrey-law/citations/review/types'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

/**
 * Runs a playbook for the Word add-in, reporting each rule the moment it
 * settles.
 *
 * The workbench queues a review and works it from a cron tick; the pane has an
 * attorney watching it, so it streams instead. Each rule is still its own
 * `runReviewPlaybook` call — the same engine, the same quote verification, the
 * same condition skipping — just several at once:
 *
 * - The first rule runs alone, so it writes the cached document prefix every
 *   later call reads. Starting them together would pay for the document N times.
 * - The rest run `concurrency` at a time. Forty rules one after another is
 *   several minutes of an attorney watching a spinner; findings arriving as they
 *   land is the difference between a tool they use and one they don't.
 *
 * Fail-soft per rule, as in the engine: a rule that fails is reported by
 * number and never costs the others.
 */

export interface RunRulesOptions {
  callModel: ModelCaller
  model?: string
  matterFacts: MatterFacts | null
  matterId: string | null
  userId: string | null
  concurrency?: number
  /** Stop starting new rules once aborted; rules already in flight still report. */
  signal?: AbortSignal
  onFinding: (finding: ReviewFinding) => void
  onFailure: (failure: { ruleNumber: string; reason: string }) => void
  /**
   * Called once per rule after its finding or failure has been reported, with
   * the rule's place in the playbook — how the route records each rule as it
   * settles. Awaited; it must not throw.
   */
  onRuleSettled?: (
    rule: ReviewRule,
    index: number,
    outcome: { findings: ReviewFinding[]; failures: Array<{ ruleNumber: string; reason: string }> },
  ) => Promise<void>
}

export const DEFAULT_REVIEW_CONCURRENCY = 5

export async function runRulesStreaming(
  layer: TextLayer,
  playbook: ReviewPlaybook,
  options: RunRulesOptions,
): Promise<{ completed: number; aborted: boolean }> {
  let completed = 0

  const runOne = async (index: number): Promise<void> => {
    const rule = playbook.rules[index]
    let outcome: { findings: ReviewFinding[]; failures: Array<{ ruleNumber: string; reason: string }> }
    try {
      const result = await runReviewPlaybook(
        layer,
        { ...playbook, rules: [rule] },
        {
          callModel: options.callModel,
          model: options.model,
          matterId: options.matterId,
          userId: options.userId,
          matterFacts: options.matterFacts,
        },
      )
      outcome = { findings: result.findings, failures: result.failures }
      if (result.findings.length === 0 && result.failures.length === 0) {
        outcome.failures = [{ ruleNumber: rule.number, reason: 'The rule produced no answer.' }]
      }
    } catch (error) {
      outcome = {
        findings: [],
        failures: [{ ruleNumber: rule.number, reason: error instanceof Error ? error.message : 'The rule could not be run.' }],
      }
    }
    for (const finding of outcome.findings) options.onFinding(finding)
    for (const failure of outcome.failures) options.onFailure(failure)
    await options.onRuleSettled?.(rule, index, outcome)
    completed += 1
  }

  const total = playbook.rules.length
  if (total === 0) return { completed, aborted: false }

  await runOne(0)

  let next = 1
  const workers = Math.max(1, Math.min(options.concurrency ?? DEFAULT_REVIEW_CONCURRENCY, total - 1))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < total && !options.signal?.aborted) {
        const index = next++
        await runOne(index)
      }
    }),
  )

  return { completed, aborted: completed < total }
}
