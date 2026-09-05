import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261028010000_seed_review_playbook.sql'),
  'utf8',
)

/**
 * The playbook used to be a bundled JSON file
 * (`tools/workflows/review/ma-trust-firm-qa.json`), asserted against
 * directly by importing it. That file is gone — this is the point of the
 * migration this test reads instead: the playbook is now a row, seeded once,
 * read at runtime through `loadReviewPlaybook` (see
 * `apps/workbench/lib/review/playbook.ts` and
 * `apps/workbench/tests/prompt-repository.test.ts` for the read path,
 * exercised there against a stubbed client).
 *
 * What is left to assert here is the seed itself: that it inserts a review
 * prompt whose body actually parses, and that its `content_hash` is the real
 * sha256 of the body it seeds rather than a copied-and-forgotten string. It
 * cannot be compared against the deleted JSON file — that comparison is
 * exactly what this test is replacing.
 */
describe('the seed migration for the review playbook', () => {
  it('inserts a prompt with the expected slug, kind, and system flag', () => {
    expect(MIGRATION).toMatch(
      /insert into public\.prompts \(id, slug, title, kind, is_system\)/,
    )
    expect(MIGRATION).toMatch(new RegExp(`'${REVIEW_PLAYBOOK_SLUG}'`))
    expect(MIGRATION).toMatch(/'review',\s*\n\s*true\s*\n\)/)
  })

  it('publishes the version it seeds', () => {
    expect(MIGRATION).toMatch(/insert into public\.prompt_publications \(prompt_id, version_id\)/)
  })

  it('makes every insert idempotent', () => {
    expect(MIGRATION).toMatch(/on conflict \(slug\) do nothing/)
    expect(MIGRATION).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
    expect(MIGRATION).toMatch(/on conflict \(prompt_id\) do nothing/)
  })

  /** Extracts the seeded body's jsonb literal, unescaping SQL's doubled `''`. */
  function seededBodyText(): string {
    const match = MIGRATION.match(/'((?:[^']|'')*)'::jsonb/)
    if (!match) throw new Error('Could not find the seeded body’s jsonb literal in the migration')
    return match[1].replace(/''/g, "'")
  }

  function seededContentHash(): string {
    const match = MIGRATION.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)
    if (!match) throw new Error('Could not find the seeded content_hash literal in the migration')
    return match[1]
  }

  it('seeds a body that parses as a review prompt body', () => {
    const body = JSON.parse(seededBodyText())
    const parsed = promptBodySchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.kind).toBe('review')
    if (parsed.data.kind !== 'review') return
    expect(parsed.data.rules.length).toBeGreaterThan(0)
    for (const rule of parsed.data.rules) {
      expect(rule.number).toBeTruthy()
      expect(rule.statement.length).toBeGreaterThan(20)
      expect(['blocker', 'high', 'medium', 'low']).toContain(rule.risk)
    }
  })

  it('numbers its rules uniquely, so a finding names exactly one', () => {
    const body = JSON.parse(seededBodyText())
    const parsed = promptBodySchema.parse(body)
    if (parsed.kind !== 'review') throw new Error('expected the seeded body to be a review body')
    const numbers = parsed.rules.map((r) => r.number)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  /**
   * The check this whole file exists for: the stated content_hash must be
   * the real sha256 of the body actually being inserted, not a value typed
   * in and never rechecked. Computed the same way the migration's own
   * comment says it was computed — sha256 of `JSON.stringify(body)`.
   */
  it('states the real sha256 of the body it seeds', () => {
    const hash = crypto.createHash('sha256').update(seededBodyText()).digest('hex')
    expect(hash).toBe(seededContentHash())
  })
})
