import { describe, expect, it } from 'vitest'

import { adminIntakeSubmitSchema } from '@/lib/validation/adminIntake'
import {
  intakeSignupSchema,
  publicIntakeStartSchema,
} from '@/lib/validation/clientAccountForms'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'

/**
 * Field path -> message, the shape react-hook-form renders from. A field can
 * collect more than one issue (an empty email is both missing and malformed);
 * the resolver's default criteriaMode keeps the first, so this does too.
 */
function issuesByPath(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const byPath: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!(path in byPath)) byPath[path] = issue.message
  }
  return byPath
}

describe('intakeSignupSchema', () => {
  it('requires an email, a long enough password, and a matching confirmation', () => {
    const result = intakeSignupSchema.safeParse({
      email: '',
      password: 'short',
      confirmPassword: 'different',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    const issues = issuesByPath(result.error)
    expect(issues.email).toBe('Required')
    expect(issues.password).toBe('Use at least 8 characters.')
    expect(issues.confirmPassword).toBe('Passwords do not match.')
  })

  it('reports a malformed email separately from a missing one', () => {
    const result = intakeSignupSchema.safeParse({
      email: 'not-an-email',
      password: 'longenough',
      confirmPassword: 'longenough',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(issuesByPath(result.error).email).toBe('Enter a valid email address.')
  })

  it('accepts a well-formed signup', () => {
    expect(
      intakeSignupSchema.safeParse({
        email: 'client@example.com',
        password: 'longenough',
        confirmPassword: 'longenough',
      }).success,
    ).toBe(true)
  })
})

describe('publicIntakeStartSchema', () => {
  const base = {
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '(555) 555-5555',
    password: 'longenough',
    confirmPassword: 'longenough',
    turnstileToken: '',
  }

  it('demands the security check only when Turnstile is configured', () => {
    const gated = publicIntakeStartSchema(true).safeParse(base)
    expect(gated.success).toBe(false)
    if (!gated.success) {
      expect(issuesByPath(gated.error).turnstileToken).toBe('Complete the security check.')
    }

    // Without a site key the widget never renders, so it cannot block the form.
    expect(publicIntakeStartSchema(false).safeParse(base).success).toBe(true)
  })

  it('trims the full name and rejects a whitespace-only one', () => {
    const padded = publicIntakeStartSchema(false).safeParse({ ...base, fullName: '  Ada  ' })
    expect(padded.success && padded.data.fullName).toBe('Ada')

    const blank = publicIntakeStartSchema(false).safeParse({ ...base, fullName: '   ' })
    expect(blank.success).toBe(false)
    if (!blank.success) expect(issuesByPath(blank.error).fullName).toBe('Required')
  })
})

describe('adminIntakeSubmitSchema', () => {
  const estate = adminIntakeSubmitSchema({ isCollegePrep: false })
  const collegePrep = adminIntakeSubmitSchema({ isCollegePrep: true })

  const named = {
    ...emptyAdminIntakeFormData(),
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
  }

  it('always requires the client name and email', () => {
    for (const schema of [estate, collegePrep]) {
      const result = schema.safeParse(emptyAdminIntakeFormData())
      expect(result.success).toBe(false)
      if (result.success) continue
      const issues = issuesByPath(result.error)
      expect(issues.first_name).toBe('Required')
      expect(issues.last_name).toBe('Required')
      expect(issues.email).toBe('Required')
    }
  })

  it('treats whitespace-only names as missing', () => {
    const result = estate.safeParse({ ...named, first_name: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(issuesByPath(result.error).first_name).toBe('Required')
  })

  it('requires marital status and at least one asset on the estate track', () => {
    const result = estate.safeParse(named)
    expect(result.success).toBe(false)
    if (result.success) return
    const issues = issuesByPath(result.error)
    expect(issues.marital_status).toBe('Required')
    expect(issues.estate_value).toBe('At least one asset field is required')
  })

  it('accepts any single asset answer in place of an estate value', () => {
    const withMarital = { ...named, marital_status: 'single' }
    expect(estate.safeParse({ ...withMarital, estate_value: '500k_2m' }).success).toBe(true)
    expect(estate.safeParse({ ...withMarital, has_real_property: true }).success).toBe(true)
    expect(estate.safeParse({ ...withMarital, has_retirement: true }).success).toBe(true)
    expect(estate.safeParse({ ...withMarital, has_investments: true }).success).toBe(true)
    expect(estate.safeParse({ ...withMarital, has_business: true }).success).toBe(true)
    expect(estate.safeParse({ ...withMarital, has_life_insurance: true }).success).toBe(true)
  })

  it('never asks the College Prep track for marital status or assets', () => {
    // Those sections are hidden on that track, so erroring on them would point
    // the attorney at fields that are not on screen.
    const result = collegePrep.safeParse(named)
    expect(result.success).toBe(true)
  })

  it('hands back the form values untouched so no field is dropped on submit', () => {
    const values = { ...named, marital_status: 'married', estate_value: '500k_2m' }
    const result = estate.safeParse(values)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(values)
      expect(Object.keys(result.data)).toHaveLength(Object.keys(values).length)
    }
  })
})
