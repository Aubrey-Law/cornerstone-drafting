import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { unknownSources } from '@aubrey-law/citations/prompt/inputs'

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../supabase/migrations/20261028020000_seed_design_sheet_audit.sql',
)
const MIGRATION = fs.readFileSync(MIGRATION_PATH, 'utf8')

/**
 * Mirrors apps/workbench/tests/review-playbook.test.ts, for the design-sheet
 * audit's seed instead of the review playbook's. What is worth asserting
 * here is the seed itself: that its body parses (which, per
 * promptBodySchema's superRefine in packages/citations/src/prompt/body.ts,
 * already proves every check's `reads` names a field one of the sixteen
 * declared inputs actually declares — a body where that failed would not
 * parse, so a successful parse is the proof), that every declared source is
 * one `resolveInputs` can actually resolve, and that the stated
 * `content_hash` is the real sha256 of the body being seeded rather than a
 * copied-and-forgotten string.
 */
describe('the seed migration for the design-sheet audit', () => {
  it('inserts a prompt with the expected slug, kind, stages, and system flag', () => {
    expect(MIGRATION).toMatch(/insert into public\.prompts \(id, slug, title, kind, stages, is_system\)/)
    expect(MIGRATION).toMatch(/'ma-design-sheet-audit'/)
    expect(MIGRATION).toMatch(/'field_audit',\s*\n\s*array\['design','drafting'\],\s*\n\s*true\s*\n\)/)
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

  it('seeds a body that parses as a field-audit prompt body with exactly six checks, the first a blocker', () => {
    const body = JSON.parse(seededBodyText())
    // A successful parse here is itself the proof that every check's `reads`
    // names a field one of the declared inputs actually declares —
    // promptBodySchema's superRefine (packages/citations/src/prompt/body.ts)
    // refuses to parse a body where that is not true, so there is nothing
    // further to assert for that property.
    const parsed = promptBodySchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.kind).toBe('field_audit')
    if (parsed.data.kind !== 'field_audit') return

    expect(parsed.data.checks).toHaveLength(6)
    expect(parsed.data.checks[0].risk).toBe('blocker')
  })

  it('declares no source outside the allow-list — the publish-time gate a seeded prompt must pass, same as an authored one would', () => {
    const body = JSON.parse(seededBodyText())
    const parsed = promptBodySchema.parse(body)
    if (parsed.kind !== 'field_audit') throw new Error('expected the seeded body to be a field_audit body')
    expect(unknownSources(parsed.inputs)).toEqual([])
  })

  it('numbers its checks uniquely, so a finding names exactly one', () => {
    const body = JSON.parse(seededBodyText())
    const parsed = promptBodySchema.parse(body)
    if (parsed.kind !== 'field_audit') throw new Error('expected the seeded body to be a field_audit body')
    const numbers = parsed.checks.map((c) => c.number)
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
