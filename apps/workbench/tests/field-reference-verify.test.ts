import { describe, expect, it } from 'vitest'
import { verifyFieldReference } from '@aubrey-law/citations/fieldAudit/verify'

const values = {
  concerns: 'Make sure my son Daniel is provided for',
  spouse_citizenship: 'Green card holder',
  include_qdot: null,
}

// Realistic shapes for the jsonb array-of-objects fields: children, assets,
// and disinheritances are exactly what the allow-listed design-sheet columns
// of the same names hold.
const structured = {
  children: [
    { name: 'Daniel Smith', dob: '2018-04-02' },
    { name: 'Ana Smith', dob: '2021-11-15' },
  ],
  assets: [{ description: '12 Elm St, Concord MA', value: 850000 }],
  disinheritances: [],
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

describe('verifying a claim against a structured (jsonb array-of-objects) field', () => {
  it('verifies a claim naming one child, citing that child rather than the whole array', () => {
    // The whole point of this fix: a model saying "Daniel Smith" should not
    // have to also reproduce Ana Smith's dob and the exact JSON punctuation
    // around both of them just to be believed.
    const result = verifyFieldReference(structured, ['children'], {
      fieldKey: 'children',
      claimedValue: 'Daniel Smith',
    })
    expect(result.verification).toBe('verified')
    expect(result.actualValue).toBe('Daniel Smith')
  })

  it('keeps the near miss readable when the named child is not in the array', () => {
    // A finding that fails to verify still needs to be legible for review, so
    // the reference must fall back to the whole structure rather than null —
    // there is no single leaf to point at, but there is still a field to read.
    const result = verifyFieldReference(structured, ['children'], {
      fieldKey: 'children',
      claimedValue: 'Danielle Smith',
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBe(JSON.stringify(structured.children))
  })

  it('verifies a claim quoting an asset description nested inside an object', () => {
    // Assets are an array of objects, one level deeper than children's flat
    // shape — the walk has to recurse into the object, not just the array.
    const result = verifyFieldReference(structured, ['assets'], {
      fieldKey: 'assets',
      claimedValue: '12 Elm St, Concord MA',
    })
    expect(result.verification).toBe('verified')
    expect(result.actualValue).toBe('12 Elm St, Concord MA')
  })

  it('verifies a claim of emptiness against an empty array of objects', () => {
    // disinheritances is exactly the shape this feature needs to be able to
    // report "none" about, and "none" has to be a claim that can pass.
    const result = verifyFieldReference(structured, ['disinheritances'], {
      fieldKey: 'disinheritances',
      claimedValue: null,
    })
    expect(result.verification).toBe('verified')
  })

  it('refuses a claim of emptiness against an array that actually has entries', () => {
    // children is non-empty, so a model claiming there are none is wrong —
    // and it must be wrong for a reason other than "no leaf equals null",
    // since that would also (incorrectly) let this claim through.
    const result = verifyFieldReference(structured, ['children'], {
      fieldKey: 'children',
      claimedValue: null,
    })
    expect(result.verification).toBe('unverified')
  })

  it('verifies a claim matching a nested numeric leaf', () => {
    // JSON.stringify(850000) is the string "850000", and normalise() only
    // folds whitespace and case — so the model has to produce the bare
    // numeral with no currency sign, comma, or word ("dollars") attached.
    // This test documents that requirement rather than assuming a friendlier
    // one: a claim of "$850,000" would NOT verify under this rule.
    const result = verifyFieldReference(structured, ['assets'], {
      fieldKey: 'assets',
      claimedValue: '850000',
    })
    expect(result.verification).toBe('verified')
    expect(result.actualValue).toBe('850000')
  })
})
