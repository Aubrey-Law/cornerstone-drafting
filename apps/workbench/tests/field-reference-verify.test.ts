import { describe, expect, it } from 'vitest'
import { verifyFieldReference } from '@aubrey-law/citations/fieldAudit/verify'

const values = {
  concerns: 'Make sure my son Daniel is provided for',
  spouse_citizenship: 'Green card holder',
  include_qdot: null,
}

describe('verifying what a check claimed a field says', () => {
  it('verifies a claim that matches the field', () => {
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'concerns',
      claimedValue: 'Make sure my son Daniel is provided for',
    })
    expect(result).toEqual({
      fieldKey: 'concerns',
      claimedValue: 'Make sure my son Daniel is provided for',
      actualValue: 'Make sure my son Daniel is provided for',
      verification: 'verified',
    })
  })

  it('verifies despite whitespace and case, which are not the claim', () => {
    const result = verifyFieldReference(values, ['spouse_citizenship'], {
      fieldKey: 'spouse_citizenship',
      claimedValue: '  green card HOLDER ',
    })
    expect(result.verification).toBe('verified')
  })

  it('refuses a claim the field does not support, and keeps what the field says', () => {
    // The analogue of attemptedQuote: the rate at which claims survive is the
    // measure, and it cannot be measured without recording the near miss.
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'concerns',
      claimedValue: 'Make sure my daughter Danielle is provided for',
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBe('Make sure my son Daniel is provided for')
  })

  it('refuses a reference to a field the check was not allowed to read', () => {
    // `reads` is the check's declared scope. A reference outside it is a
    // finding resting on something nobody authorised it to consult.
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'spouse_citizenship',
      claimedValue: 'Green card holder',
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBeNull()
  })

  it('verifies a claim of emptiness against an empty field', () => {
    // Absence is the finding this check set exists to catch, so "this field is
    // empty" has to be a claim that can be verified rather than one that
    // always fails for want of anything to match.
    const result = verifyFieldReference(values, ['include_qdot'], {
      fieldKey: 'include_qdot',
      claimedValue: null,
    })
    expect(result.verification).toBe('verified')
  })

  it('refuses a claim of emptiness about a field it never received', () => {
    // "Empty" and "never read" are different claims and only one of them can
    // be checked. Treating them alike would let a wiring mistake produce a
    // verified finding about a fact the run never looked at.
    const result = verifyFieldReference(values, ['not_supplied'], {
      fieldKey: 'not_supplied',
      claimedValue: null,
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBeNull()
  })

  it('still verifies emptiness for a field that was read and is empty', () => {
    // The distinction must not cost the case it was built for: include_qdot
    // is present and null, and a claim that it is empty is correct.
    const result = verifyFieldReference(values, ['include_qdot'], {
      fieldKey: 'include_qdot',
      claimedValue: null,
    })
    expect(result.verification).toBe('verified')
  })
})
