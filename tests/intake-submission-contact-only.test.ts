import { describe, expect, it } from 'vitest'
import {
  getStepErrors,
  getSubmissionErrors,
  isReadyToReview,
  type IntakeRow,
} from '@/lib/intakeSections'

const CONTACT: IntakeRow = {
  first_name: 'Jane',
  last_name: 'Example',
  email: 'jane@example.com',
  phone: '(617) 555-0100',
}

describe('intake submission requires only contact information', () => {
  it('submits with nothing but contact information filled in', () => {
    expect(getSubmissionErrors(CONTACT)).toEqual([])
    expect(isReadyToReview(CONTACT)).toBe(true)
  })

  it('submits with incomplete later sections, which still show their own errors', () => {
    const data: IntakeRow = {
      ...CONTACT,
      marital_status: 'married',
      has_children: true,
      has_minor_children: true,
      _children: [{ first_name: '', last_name: '' }],
    }
    expect(getStepErrors('personal', data).length).toBeGreaterThan(0) // address, DOB, county
    expect(getStepErrors('spouse', data).length).toBeGreaterThan(0)
    expect(getStepErrors('children', data).length).toBeGreaterThan(0)
    expect(getStepErrors('guardian', data).length).toBeGreaterThan(0)
    expect(isReadyToReview(data)).toBe(true)
  })

  it.each([
    ['first_name', 'Enter your first name.'],
    ['last_name', 'Enter your last name.'],
    ['email', 'Enter your email address.'],
    ['phone', 'Enter your phone number.'],
  ])('blocks submission while %s is missing', (field, message) => {
    const errors = getSubmissionErrors({ ...CONTACT, [field]: '' })
    expect(errors.map((issue) => issue.message)).toEqual([message])
    expect(errors[0].sectionId).toBe('personal')
  })

  it('blocks submission on an invalid email', () => {
    expect(isReadyToReview({ ...CONTACT, email: 'not-an-email' })).toBe(false)
  })
})
