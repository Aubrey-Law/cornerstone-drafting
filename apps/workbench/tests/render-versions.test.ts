import { describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_RENDER_VERSION,
  FIELD_AUDIT_RENDERS,
  fieldAuditRender,
} from '@aubrey-law/citations/fieldAudit/render'
import {
  FIELD_AUDIT_INSTRUCTIONS,
  FIELD_AUDIT_TOOL,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'

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
    for (const [version, render] of Object.entries(FIELD_AUDIT_RENDERS)) {
      expect(render.instructions.trim().length, `v${version} instructions`).toBeGreaterThan(0)
      expect(render.tool.name.length, `v${version} tool name`).toBeGreaterThan(0)
      expect(render.maxTokens, `v${version} maxTokens`).toBeGreaterThan(0)
      expect(typeof render.checkMessage, `v${version} checkMessage`).toBe('function')
      expect(typeof render.sheet, `v${version} sheet`).toBe('function')
      expect(typeof render.parse, `v${version} parse`).toBe('function')
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
})
