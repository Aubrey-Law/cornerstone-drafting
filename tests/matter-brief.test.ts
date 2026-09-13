import { describe, expect, it } from 'vitest'
import {
  MAX_FACT_SHEET_CHARS,
  capFactSheet,
  matterBriefPromptSection,
  type MatterBrief,
} from '@/lib/drafting/matterBrief'

const BRIEF: MatterBrief = {
  matterId: 'm-1',
  matterNumber: 'EP-2026-014',
  clientName: 'Jordan Ellis',
  spouseName: null,
  matterType: 'individual',
  practiceArea: 'estate_planning',
  trustName: null,
  factSheet: 'Matter snapshot:\n- Trustee initial: [UNKNOWN]',
  truncated: false,
}

/**
 * What the model is told about the matter, and how.
 *
 * These are the safety-critical half of design-sheet awareness. A drafting
 * assistant that invents a successor trustee produces a document that reads as
 * finished and names the wrong person, and no amount of fluency downstream
 * catches that — so the instructions that prevent it are pinned here rather
 * than left to whoever next edits the prompt.
 */
describe('the design sheet as the model receives it', () => {
  const section = matterBriefPromptSection(BRIEF)

  it('identifies the matter and client', () => {
    expect(section).toContain('EP-2026-014')
    expect(section).toContain('Jordan Ellis')
  })

  it('carries the fact sheet', () => {
    expect(section).toContain('- Trustee initial: [UNKNOWN]')
  })

  it('fences the sheet as untrusted data', () => {
    // The design sheet is seeded from client intake, so its names and notes are
    // free text a client typed. `quoteUserContent` is what makes them content
    // rather than instructions.
    expect(section).toContain('<matter-design-sheet>')
    expect(section).toContain('</matter-design-sheet>')
    expect(section).toContain('untrusted user data')
  })

  it('makes the design sheet win over a stale document', () => {
    expect(section).toMatch(/source of truth/i)
  })

  it('forbids inventing a value, and says what to do with [UNKNOWN] instead', () => {
    expect(section).toMatch(/never invent/i)
    expect(section).toContain('[UNKNOWN]')
    expect(section).toMatch(/placeholder/i)
  })
})

describe('capFactSheet', () => {
  it('leaves a normal sheet alone', () => {
    const { factSheet, truncated } = capFactSheet('short')
    expect(factSheet).toBe('short')
    expect(truncated).toBe(false)
  })

  it('marks a sheet it had to cut', () => {
    // `special_provisions` and `ancillary_docs` are attorney free text with no
    // length limit; without a cap one pasted memo crowds out the document.
    const { factSheet, truncated } = capFactSheet('x'.repeat(MAX_FACT_SHEET_CHARS + 500))
    expect(truncated).toBe(true)
    expect(factSheet).toContain('[TRUNCATED]')
    expect(factSheet.length).toBeLessThan(MAX_FACT_SHEET_CHARS + 50)
  })

  it('does not mark a sheet that exactly fits', () => {
    expect(capFactSheet('x'.repeat(MAX_FACT_SHEET_CHARS)).truncated).toBe(false)
  })
})
