import { describe, expect, it } from 'vitest'
import { REVIEW_PLAYBOOK_SLUG, loadReviewPlaybook } from '@/lib/review/playbook'

/**
 * The playbook is firm content, bundled with the repository rather than typed
 * into a screen. Reading it through the workspace package means both apps run
 * the same rules, and this test fails if the file drifts out of the schema the
 * runner expects — which would otherwise surface as a review that silently
 * skipped a rule.
 */
describe('loadReviewPlaybook', () => {
  it('loads the bundled Massachusetts trust playbook', () => {
    const playbook = loadReviewPlaybook()
    expect(playbook.slug).toBe(REVIEW_PLAYBOOK_SLUG)
    expect(playbook.rules.length).toBeGreaterThan(0)
    expect(playbook.version).toBeGreaterThan(0)
  })

  it('gives every rule a number, a statement and a risk', () => {
    for (const rule of loadReviewPlaybook().rules) {
      expect(rule.number).toBeTruthy()
      expect(rule.statement.length).toBeGreaterThan(20)
      expect(['blocker', 'high', 'medium', 'low']).toContain(rule.risk)
    }
  })

  it('numbers its rules uniquely, so a finding names exactly one', () => {
    const numbers = loadReviewPlaybook().rules.map((r) => r.number)
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})
