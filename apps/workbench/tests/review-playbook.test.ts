import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_PLAYBOOK_SLUG, loadReviewPlaybook } from '@/lib/review/playbook'

/**
 * The playbook is firm content, bundled with the repository rather than typed
 * into a screen. Reading it through the workspace package means both apps run
 * the same rules, and this test fails if the file drifts out of the schema the
 * runner expects — which would otherwise surface as a review that silently
 * skipped a rule.
 */
describe('loadReviewPlaybook', () => {
  afterEach(() => vi.restoreAllMocks())

  /**
   * The playbook must be a module the compiler bundles, never a file read at
   * runtime.
   *
   * This is not a preference. Next traces a serverless bundle by following
   * imports, so an `fs.readFileSync` is invisible to it: the route builds
   * clean, deploys, and throws ENOENT on the first request. It did exactly
   * that. `outputFileTracingIncludes` was supposed to cover it and silently
   * did not — its globs resolve against the project directory, not
   * `outputFileTracingRoot`, so a path pointing at the repository root matched
   * nothing and nothing said so.
   *
   * Asserting the config listed the file was what let that through. Asserting
   * the filesystem is never touched cannot be satisfied by a mistake.
   */
  it('reads nothing from disk, so no tracing config can break it', () => {
    const readFileSync = vi.spyOn(fs, 'readFileSync')
    expect(loadReviewPlaybook().rules.length).toBeGreaterThan(0)
    expect(readFileSync).not.toHaveBeenCalled()
  })

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
