import { describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  fieldAuditRender,
} from '@aubrey-law/citations/fieldAudit/render'
import {
  checkMessage,
  FIELD_AUDIT_INSTRUCTIONS,
  FIELD_AUDIT_TOOL,
  sheetForPrompt,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

/** Two reads, so `checkMessage`'s join of the list is actually exercised. */
const CHECK: FieldAuditCheck = {
  number: '4',
  statement: 'Every minor child has a nominated guardian.',
  risk: 'blocker',
  reads: ['children', 'guardian_nominations'],
  taskTemplate: {
    title: 'Nominate a guardian',
    description: 'The sheet names minor children and no guardian.',
    priority: 'high',
  },
}

describe('the field-audit render registry', () => {
  it('resolves the current version to a complete entry', () => {
    const render = fieldAuditRender(CURRENT_FIELD_AUDIT_RENDER_VERSION)
    expect(render.instructions.trim().length).toBeGreaterThan(0)
    expect(render.tool.name.length).toBeGreaterThan(0)
    expect(render.tool.input_schema).toBeTruthy()
    expect(render.maxTokens).toBeGreaterThan(0)
  })

  /** A bumped CURRENT_ with no entry would render `undefined` as the system
   *  prompt, and the model would answer anyway. */
  it('has no half-built entry', () => {
    // The loop below visits only the entries that exist, so this line is the
    // half that earns the comment above it.
    expect(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION]).toBeTruthy()

    for (const [version, render] of Object.entries(FIELD_AUDIT_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      // Called, not type-checked: that these three *are* functions is already
      // guaranteed by the interface, so asserting it proves nothing. What the
      // type cannot say is that they return anything.
      expect(render.checkMessage(CHECK).length, `v${version} checkMessage`).toBeGreaterThan(0)
      expect(render.sheet({}).length, `v${version} sheet`).toBeGreaterThan(0)
      expect(render.parse({}).claims, `v${version} parse`).toEqual([])
    }
  })

  it('falls back to current for a run made before versioning', () => {
    expect(fieldAuditRender(null)).toBe(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION])
    expect(fieldAuditRender(undefined)).toBe(FIELD_AUDIT_RENDERS[CURRENT_FIELD_AUDIT_RENDER_VERSION])
  })

  /**
   * A hard error, not a fallback. A run pinning a version this build has lost
   * is a run nobody can honestly finish, and substituting a different render
   * would answer a different question while the run still reports its own
   * version.
   */
  it('refuses a version it does not have, rather than substituting one', () => {
    expect(() => fieldAuditRender(99)).toThrow(/version 99/)
  })
})

/**
 * The extraction has to change nothing. These compare version 1's entry
 * against the constants the engine uses today; Task 2 removes the old
 * constants and these assertions go with them.
 */
describe('version 1 is today behaviour, moved', () => {
  it('carries the same instruction text', () => {
    expect(FIELD_AUDIT_RENDERS[1].instructions).toBe(FIELD_AUDIT_INSTRUCTIONS[1])
  })

  it('carries the same tool', () => {
    expect(FIELD_AUDIT_RENDERS[1].tool).toEqual(FIELD_AUDIT_TOOL)
  })

  /**
   * The literal, not `toBeGreaterThan(0)`. A typo — 1042 — satisfies every
   * other assertion in this file and would ship, and unlike the instructions
   * and the tool there is no constant left to compare it against once the
   * originals go.
   */
  it('carries the same max_tokens', () => {
    expect(FIELD_AUDIT_RENDERS[1].maxTokens).toBe(1024)
  })

  /**
   * Compared against the live original rather than a transcribed expected
   * string: a fixture would be written by reading the same file, and would
   * prove only that it was copied accurately.
   *
   * The values exercise all three branches of `formatFieldValue` — a plain
   * string, a null, and a jsonb-style array of objects whose leaves
   * `collectLeaves` renders as indented `path = value` lines.
   */
  it('formats the sheet identically', () => {
    const values = {
      testator_full_name: 'Jane Q. Public',
      guardian_nominations: null,
      children: [
        { full_name: 'Alex Public', date_of_birth: '2015-04-02' },
        { full_name: 'Sam Public', date_of_birth: '2018-11-30' },
      ],
    }

    const rendered = FIELD_AUDIT_RENDERS[1].sheet(values)
    expect(rendered).toBe(sheetForPrompt(values))
    // Guards the fixture itself: an equal-to-original assertion still passes
    // if the values stop reaching two of the three branches.
    expect(rendered).toContain('(empty)')
    expect(rendered).toContain('  children[0].full_name = Alex Public')
  })

  it('words a check message identically', () => {
    expect(FIELD_AUDIT_RENDERS[1].checkMessage(CHECK)).toBe(checkMessage(CHECK))
  })
})
