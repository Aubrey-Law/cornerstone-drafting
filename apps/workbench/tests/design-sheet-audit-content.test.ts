import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { unknownSources } from '@aubrey-law/citations/prompt/inputs'

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../supabase/migrations/20261101000000_design_sheet_audit_v2.sql',
)
const MIGRATION = fs.readFileSync(MIGRATION_PATH, 'utf8')

/** The same prompt id 20261028020000 seeded version 1 under — version 2 is a
 * new version of that prompt, not a new prompt. */
const PROMPT_ID = 'acd6881b-cfaa-4d44-ac24-8a47607d2d87'

/**
 * Mirrors apps/workbench/tests/review-playbook.test.ts, for the design-sheet
 * audit's version-2 seed instead of the review playbook's. What is worth
 * asserting here is the seed itself: that its body parses (which, per
 * promptBodySchema's superRefine in packages/citations/src/prompt/body.ts,
 * already proves every check's `reads` names a field one of the declared
 * inputs actually declares — a body where that failed would not parse, so a
 * successful parse is the proof), that every declared source is one
 * `resolveInputs` can actually resolve, that the stated `content_hash` is the
 * real sha256 of the body being seeded rather than a copied-and-forgotten
 * string, and — the reason version 2 exists — that checks 1 and 2 actually
 * read a fiduciary field now, not only the beneficiary fields version 1 left
 * them with.
 *
 * Version 1 (20261028020000_seed_design_sheet_audit.sql) is left exactly as
 * it was: prompt_versions is immutable, and this file's own tests for it
 * still run and still pass unchanged.
 */
describe('the version-2 seed migration for the design-sheet audit', () => {
  it('adds a new version of the same prompt, not a new one', () => {
    expect(MIGRATION).toMatch(/insert into public\.prompt_versions \(/)
    expect(MIGRATION).toContain(`'${PROMPT_ID}'`)
    // No `insert into public.prompts`: version 2 is a version of the prompt
    // 20261028020000 already created, not a second prompt row.
    expect(MIGRATION).not.toMatch(/insert into public\.prompts\s*\(/)
  })

  it('repoints the publication to the new version', () => {
    expect(MIGRATION).toMatch(/insert into public\.prompt_publications \(prompt_id, version_id\)/)
    // `on conflict (prompt_id) do nothing` would leave the existing
    // publication row pointed at version 1 forever — the exact bug this
    // migration exists to fix would then survive its own fix. Repointing an
    // existing row needs `do update`, not `do nothing`.
    expect(MIGRATION).toMatch(/on conflict \(prompt_id\) do update/)
    expect(MIGRATION).toMatch(/set\s+version_id\s*=\s*excluded\.version_id/)
  })

  it('makes the new version insert idempotent', () => {
    expect(MIGRATION).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
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
   * The whole reason this version exists: checks 1 and 2 could not see a
   * single fiduciary field in version 1, and both reported a real matter's
   * named guardians as missing from the plan while the plan in fact named
   * them. Version 2 has to actually fix that, not merely claim to.
   */
  it('has checks 1 and 2 read at least one fiduciary field now', () => {
    const body = JSON.parse(seededBodyText())
    const parsed = promptBodySchema.parse(body)
    if (parsed.kind !== 'field_audit') throw new Error('expected the seeded body to be a field_audit body')

    const fiduciaryFields = [
      'guardian_primary',
      'guardian_alt1',
      'trustee_primary',
      'trustee_alt1',
      'executor_primary',
      'hcp_primary',
      'poa_primary',
      'guardian_slots',
      'temporary_guardian_slots',
      'trustee_slots',
      'executor_slots',
      'hcp_slots',
      'poa_slots',
    ]

    const check1 = parsed.checks.find((c) => c.number === '1')
    const check2 = parsed.checks.find((c) => c.number === '2')
    expect(check1).toBeDefined()
    expect(check2).toBeDefined()
    expect(check1!.reads.some((field) => fiduciaryFields.includes(field))).toBe(true)
    expect(check2!.reads.some((field) => fiduciaryFields.includes(field))).toBe(true)

    // Check 2 asks whether a person appears *anywhere* in the plan, so it has
    // to see every place a person can be recorded — every name-bearing
    // fiduciary field and every resolved slot, not just one of them.
    const nameFields = ['guardian_primary', 'guardian_alt1', 'trustee_primary', 'trustee_alt1', 'executor_primary', 'hcp_primary', 'poa_primary', 'spouse_name', 'client_name']
    const slotFields = ['guardian_slots', 'temporary_guardian_slots', 'trustee_slots', 'executor_slots', 'hcp_slots', 'poa_slots']
    for (const field of [...nameFields, ...slotFields]) {
      expect(check2!.reads).toContain(field)
    }
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

/**
 * Version 3 divides checks 1 and 2 by subject rather than by fields.
 *
 * Version 2 gave both the fiduciary fields, which fixed their false positives
 * and made them overlap: one guardian gap raised two blocker tasks. Check 1
 * keeps the fiduciary fields — without them it cannot see that a concern about
 * who decides was answered — but is told to report provisions and leave named
 * persons to check 2.
 */
describe('the version-3 seed migration for the design-sheet audit', () => {
  const V3 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261102000000_design_sheet_audit_v3.sql'),
    'utf8',
  )
  const bodyText = () =>
    V3.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")

  it('publishes version 3, and repoints rather than doing nothing', () => {
    // A `do nothing` here would leave the publication on version 2 — the
    // exact failure the v2 migration already had to correct.
    expect(V3).toMatch(/version_number\s*\)?\s*\n?.*3,|,\s*\n\s*3,/)
    expect(V3).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('leaves check 1 able to see the fiduciary fields', () => {
    // Removing them would reintroduce the false positive v2 fixed: a concern
    // about who decides, answered by an appointment it could not see.
    const body = JSON.parse(bodyText())
    const check1 = body.checks.find((c: { number: string }) => c.number === '1')
    expect(check1.reads).toContain('guardian_slots')
    expect(check1.reads).toContain('guardian_primary')
  })

  it('tells check 1 to leave a named person to check 2', () => {
    const body = JSON.parse(bodyText())
    const check1 = body.checks.find((c: { number: string }) => c.number === '1')
    expect(check1.statement).toMatch(/check 2/i)
  })

  it('leaves check 2 exactly as version 2 had it', () => {
    // The division is one-sided on purpose: check 2 was already right.
    const v2 = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261101000000_design_sheet_audit_v2.sql'),
      'utf8',
    )
    const pick = (sql: string) =>
      JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'"))
        .checks.find((c: { number: string }) => c.number === '2')
    expect(pick(V3)).toEqual(pick(v2))
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V3.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    expect(crypto.createHash('sha256').update(bodyText()).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    expect(promptBodySchema.safeParse(JSON.parse(bodyText())).success).toBe(true)
  })
})

/**
 * Version 4 changes what a run *produces*, not what it checks.
 *
 * `outputTarget` lives in the body rather than on `prompts` because a run
 * records only its `prompt_version_id`: as a mutable column, an old run would
 * be indistinguishable from one that produced something else. So a change of
 * target is a new version, and the checks themselves are untouched — which is
 * the strongest thing this block can assert, and it does.
 */
describe('the version-4 seed migration for the design-sheet audit', () => {
  const V4 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261104000000_design_sheet_audit_v4.sql'),
    'utf8',
  )
  const bodyText = () => V4.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")

  it('publishes version 4, and repoints rather than doing nothing', () => {
    // A `do nothing` here would leave the publication on version 3 — the
    // exact failure the v2 migration already had to correct.
    expect(V4).toMatch(/version_number\s*\)?\s*\n?.*4,|,\s*\n\s*4,/)
    expect(V4).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('makes the new version insert idempotent', () => {
    expect(V4).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
  })

  it('adds a version of the same prompt, found by slug rather than a pasted id', () => {
    // An earlier migration in this series pasted an id lifted by pattern and
    // got the *version's* id instead of the prompt's. Selecting by the thing
    // that is stable removes the question.
    expect(V4).toMatch(/where p\.slug = 'ma-design-sheet-audit'/)
    expect(V4).not.toMatch(/insert into public\.prompts\s*\(/)
  })

  it('says checklist', () => {
    const parsed = promptBodySchema.parse(JSON.parse(bodyText()))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(parsed.outputTarget).toBe('checklist')
  })

  /**
   * The whole claim of this version: it changes the target and nothing else.
   * Comparing the parsed checks against version 3's proves the body was
   * derived rather than retyped — a hand-edited copy would drift a statement
   * or a `reads` entry and nobody would notice until a run behaved
   * differently for a reason nobody chose.
   */
  it('leaves every check exactly as version 3 had it', () => {
    const v3 = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261102000000_design_sheet_audit_v3.sql'),
      'utf8',
    )
    const checksOf = (sql: string) =>
      JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")).checks
    expect(checksOf(V4)).toEqual(checksOf(v3))
  })

  it('leaves version 3’s own inputs alone too', () => {
    const v3 = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261102000000_design_sheet_audit_v3.sql'),
      'utf8',
    )
    const inputsOf = (sql: string) =>
      JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")).inputs
    expect(inputsOf(V4)).toEqual(inputsOf(v3))
  })

  it('declares no source outside the allow-list', () => {
    const parsed = promptBodySchema.parse(JSON.parse(bodyText()))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(unknownSources(parsed.inputs)).toEqual([])
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V4.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    expect(crypto.createHash('sha256').update(bodyText()).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    expect(promptBodySchema.safeParse(JSON.parse(bodyText())).success).toBe(true)
  })
})

/**
 * Version 5 resolves an ambiguity in check 2 rather than changing what the
 * audit checks.
 *
 * Version 4's statement contained two questions: a topic sentence asking
 * whether a person named in free text appears in the structured decisions —
 * any of them — and a second sentence narrowing to "no beneficiary or
 * fiduciary field". Across six runs on one unchanged sheet the model answered
 * the first five times and the second once, and the once was a false blocker:
 * both runs cited identical evidence and differed only in which half they
 * treated as the answer.
 */
describe('the version-5 seed migration for the design-sheet audit', () => {
  const V5 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261107000000_design_sheet_audit_v5.sql'),
    'utf8',
  )
  const V4 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261104000000_design_sheet_audit_v4.sql'),
    'utf8',
  )
  const bodyOf = (sql: string) =>
    JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'"))

  it('publishes version 5, and repoints rather than doing nothing', () => {
    expect(V5).toMatch(/version_number\s*\)?\s*\n?.*5,|,\s*\n\s*5,/)
    expect(V5).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('makes the new version insert idempotent', () => {
    expect(V5).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
  })

  it('finds the prompt by slug rather than a pasted id', () => {
    expect(V5).toMatch(/where p\.slug = 'ma-design-sheet-audit'/)
    expect(V5).not.toMatch(/insert into public\.prompts\s*\(/)
  })

  /**
   * The whole claim of this version: it changes one statement and nothing
   * else. Asserted by comparison rather than by reading, because a
   * hand-edited copy would drift a `reads` entry and nobody would notice
   * until a run behaved differently for a reason nobody chose.
   */
  it('changes only check 2’s statement, leaving every other check identical', () => {
    const a = bodyOf(V4)
    const b = bodyOf(V5)
    expect(b.inputs).toEqual(a.inputs)
    expect(b.outputTarget).toEqual(a.outputTarget)
    expect(b.checks).toHaveLength(a.checks.length)
    for (const [i, before] of a.checks.entries()) {
      const after = b.checks[i]
      if (before.number === '2') {
        expect(after.statement).not.toEqual(before.statement)
        // Everything about check 2 except its wording is untouched.
        expect({ ...after, statement: '' }).toEqual({ ...before, statement: '' })
      } else {
        expect(after).toEqual(before)
      }
    }
  })

  /** The three things the new statement has to say, each tied to an observed
   *  failure: a category is not a name, any structured field counts, and a
   *  provision gap belongs to check 1. */
  it('states the trigger, the satisfaction and the deferral', () => {
    const check2 = bodyOf(V5).checks.find((c: { number: string }) => c.number === '2')
    expect(check2.statement).toMatch(/descendants/)
    expect(check2.statement).toMatch(/spouse_name/)
    expect(check2.statement).toMatch(/check 1/)
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V5.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    const literal = V5.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")
    expect(crypto.createHash('sha256').update(literal).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    const parsed = promptBodySchema.safeParse(bodyOf(V5))
    expect(parsed.success).toBe(true)
  })

  it('declares no source outside the allow-list', () => {
    const parsed = promptBodySchema.parse(bodyOf(V5))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(unknownSources(parsed.inputs)).toEqual([])
  })
})

/**
 * Version 6 exists because of one run.
 *
 * On 2026-09-08 the audit fired for the first time against a matter outside
 * `{design, drafting}` — every earlier measurement came from repeatedly
 * running one `drafting` matter, where check 6 answered `not_applicable` on
 * all seven runs and had never once produced a finding. On a `client_review`
 * sheet whose `assets` is an empty array it reported a `high` deviation,
 * taking the property figures from `concerns` (which it may not cite) and
 * referencing `assets` and `real_property_transfer` as empty instead.
 *
 * Both references verified, because emptiness is verifiable. So the finding
 * looked supported, passed `isActionable`, and produced a task: true claims,
 * a conclusion that does not follow, and the one class of error the citation
 * gate cannot catch.
 */
describe('the version-6 seed migration for the design-sheet audit', () => {
  const V6 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261112000000_design_sheet_audit_v6.sql'),
    'utf8',
  )
  const V5 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261107000000_design_sheet_audit_v5.sql'),
    'utf8',
  )
  const bodyOf = (sql: string) =>
    JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'"))

  it('publishes version 6, and repoints rather than doing nothing', () => {
    expect(V6).toMatch(/version_number\s*\)?\s*\n?.*6,|,\s*\n\s*6,/)
    expect(V6).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('makes the new version insert idempotent', () => {
    expect(V6).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
  })

  it('finds the prompt by slug rather than a pasted id', () => {
    expect(V6).toMatch(/where p\.slug = 'ma-design-sheet-audit'/)
    expect(V6).not.toMatch(/insert into public\.prompts\s*\(/)
  })

  /** The whole claim of this version: one statement changes and nothing else. */
  it('changes only check 6’s statement, leaving every other check identical', () => {
    const a = bodyOf(V5)
    const b = bodyOf(V6)
    expect(b.inputs).toEqual(a.inputs)
    expect(b.outputTarget).toEqual(a.outputTarget)
    expect(b.checks).toHaveLength(a.checks.length)
    for (const [i, before] of a.checks.entries()) {
      const after = b.checks[i]
      if (before.number === '6') {
        expect(after.statement).not.toEqual(before.statement)
        // Its reads and task template are untouched — only the wording moves.
        expect({ ...after, statement: '' }).toEqual({ ...before, statement: '' })
      } else {
        expect(after).toEqual(before)
      }
    }
  })

  /**
   * The three things the new statement has to say, each tied to the observed
   * failure: the asset list is the subject, an empty one puts nothing in
   * scope, and property described only in free text belongs to check 1.
   */
  it('names its subject, scopes itself out, and defers', () => {
    const check6 = bodyOf(V6).checks.find((c: { number: string }) => c.number === '6')
    expect(check6.statement).toMatch(/assets/)
    expect(check6.statement).toMatch(/does not apply/)
    expect(check6.statement).toMatch(/check 1/)
  })

  /**
   * Scoped, not excused. The failure mode of this fix is silencing the check
   * altogether, so what it still demands has to survive: a parcel that IS
   * recorded without a decision must remain a finding. A version that dropped
   * the requirement would pass every assertion above.
   */
  it('still requires a recorded parcel to have a transfer decision', () => {
    const check6 = bodyOf(V6).checks.find((c: { number: string }) => c.number === '6')
    expect(check6.statement).toMatch(/transfer decision/)
    expect(check6.statement).toMatch(/outside Massachusetts/)
    expect(check6.risk).toBe('high')
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V6.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    const literal = V6.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")
    expect(crypto.createHash('sha256').update(literal).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    expect(promptBodySchema.safeParse(bodyOf(V6)).success).toBe(true)
  })

  it('declares no source outside the allow-list', () => {
    const parsed = promptBodySchema.parse(bodyOf(V6))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(unknownSources(parsed.inputs)).toEqual([])
  })
})

/**
 * Version 7 exists because of seven runs.
 *
 * Version 5 fixed check 2's two-questions ambiguity, which produced a false
 * blocker one run in six. It stated the trigger positively — the name must be
 * written in the free text to be in scope — and never stated the converse.
 *
 * Measured 2026-09-08 on a `client_review` sheet, seven runs under version 6,
 * input byte-identical each time: check 2 reported a blocker **7 of 7**. The
 * sheet records a trustee in `trustee_slots` and nowhere in the free text.
 * Every run noticed her, asked whether she appeared in the concerns, and
 * treated her absence there as the violation — the inverse of the question —
 * then confirmed the two free-text names were both captured and reported
 * `deviation` regardless.
 */
describe('the version-7 seed migration for the design-sheet audit', () => {
  const V7 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261113000000_design_sheet_audit_v7.sql'),
    'utf8',
  )
  const V6 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261112000000_design_sheet_audit_v6.sql'),
    'utf8',
  )
  const bodyOf = (sql: string) =>
    JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'"))

  it('publishes version 7, and repoints rather than doing nothing', () => {
    expect(V7).toMatch(/version_number\s*\)?\s*\n?.*7,|,\s*\n\s*7,/)
    expect(V7).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('makes the new version insert idempotent', () => {
    expect(V7).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
  })

  it('changes only check 2’s statement, leaving every other check identical', () => {
    const a = bodyOf(V6)
    const b = bodyOf(V7)
    expect(b.inputs).toEqual(a.inputs)
    expect(b.outputTarget).toEqual(a.outputTarget)
    for (const [i, before] of a.checks.entries()) {
      const after = b.checks[i]
      if (before.number === '2') {
        expect(after.statement).not.toEqual(before.statement)
        expect({ ...after, statement: '' }).toEqual({ ...before, statement: '' })
      } else {
        expect(after).toEqual(before)
      }
    }
  })

  /** The rule the seven runs show is missing: the direction, and that the
   *  inverse is normal rather than merely out of scope. */
  it('states the direction and dismisses the inverse', () => {
    const check2 = bodyOf(V7).checks.find((c: { number: string }) => c.number === '2')
    expect(check2.statement).toMatch(/one-way/)
    expect(check2.statement).toMatch(/not a finding/)
    expect(check2.statement).toMatch(/fiduciary slot/)
  })

  /**
   * Scoped, not silenced — the failure mode of this fix. This is check 2's
   * second narrowing in two days, and a version that dropped the original
   * demand would satisfy every assertion above. What it must still catch: a
   * name written in the free text that no structured field mentions.
   */
  it('still catches a free-text name that no structured field mentions', () => {
    const check2 = bodyOf(V7).checks.find((c: { number: string }) => c.number === '2')
    expect(check2.statement).toMatch(/Every person whose name appears in the client's free text/)
    expect(check2.statement).toMatch(/the structured decisions never mention/)
    expect(check2.statement).toMatch(/descendants/)
    expect(check2.risk).toBe('blocker')
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V7.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    const literal = V7.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")
    expect(crypto.createHash('sha256').update(literal).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    expect(promptBodySchema.safeParse(bodyOf(V7)).success).toBe(true)
  })
})
