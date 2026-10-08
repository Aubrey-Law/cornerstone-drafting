import { describe, expect, it } from 'vitest'

import {
  captureLegacyIntakeResult,
  CONTACT_ONLY,
  INTAKE_PARITY_CASES,
} from '@/tests/fixtures/intakeFormParity'

describe('legacy intake behavior parity matrix', () => {
  it.each(INTAKE_PARITY_CASES)('captures the $name intake result', ({ data }) => {
    const result = captureLegacyIntakeResult(data)

    expect(result.activeIds.length).toBeGreaterThan(0)
    expect(result.requiredIds.every((id) => result.activeIds.includes(id))).toBe(true)
    expect(Object.keys(result.completionById)).toEqual(result.activeIds)
    expect(Object.keys(result.issuesById)).toEqual(result.activeIds)
  })

  it('keeps spouse, spouse fiduciary, child, and guardian steps conditional', () => {
    const result = captureLegacyIntakeResult(INTAKE_PARITY_CASES[2].data)

    expect(result.activeIds).toContain('spouse')
    expect(result.activeIds).toContain('spouse_fiduciaries')
    expect(result.activeIds).toContain('children')
    expect(result.activeIds).toContain('guardian')
    expect(captureLegacyIntakeResult(CONTACT_ONLY).activeIds).not.toContain('spouse')
    expect(captureLegacyIntakeResult(CONTACT_ONLY).activeIds).not.toContain('guardian')
  })

  it('keeps the estate and college tracks isolated', () => {
    const estate = captureLegacyIntakeResult(INTAKE_PARITY_CASES[0].data)
    const college = captureLegacyIntakeResult(INTAKE_PARITY_CASES[5].data)

    expect(estate.activeIds).toContain('estate')
    expect(estate.activeIds).not.toContain('cp_student')
    expect(college.activeIds).toContain('cp_student')
    expect(college.activeIds).not.toContain('estate')
    expect(college.activeIds).not.toContain('spouse')
    expect(college.activeIds).not.toContain('guardian')
  })

  it('excludes optional sections and review from required steps', () => {
    const estate = captureLegacyIntakeResult(INTAKE_PARITY_CASES[0].data)
    const college = captureLegacyIntakeResult(INTAKE_PARITY_CASES[5].data)

    expect(estate.requiredIds).not.toContain('referral')
    expect(estate.requiredIds).not.toContain('additional_contacts')
    expect(estate.requiredIds).not.toContain('review')
    expect(college.requiredIds).not.toContain('cp_healthcare')
    expect(college.requiredIds).not.toContain('cp_other')
    expect(college.requiredIds).not.toContain('review')
  })

  it('allows contact-only estate intake to submit', () => {
    expect(captureLegacyIntakeResult(CONTACT_ONLY).submissionErrors).toEqual([])
  })

  it('warns without blocking when a college student is under eighteen', () => {
    const result = captureLegacyIntakeResult(INTAKE_PARITY_CASES[6].data)
    const warning = result.issuesById.cp_student.find((issue) => issue.message.includes('under 18'))

    expect(warning).toMatchObject({ severity: 'warning', blocksSubmission: false })
    expect(result.submissionErrors).toEqual([])
  })
})
