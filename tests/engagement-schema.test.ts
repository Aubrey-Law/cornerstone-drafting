import { describe, expect, it } from 'vitest'
import { validateEngagementInput } from '@/lib/engagement/schema'

const base = {
  practiceArea: 'EP' as const,
  clientMode: 'individual' as const,
  agreementDate: '2026-07-11',
  primary: { name: 'Alex Client', email: 'alex@example.com' },
  spouse: null,
  legalPlan: null,
  fee: { amount: 5000, paymentTerms: 'Due on signing' },
  scopeKey: 'standard',
  optionalClauseKeys: [],
  emailMessage: 'Please review and sign.',
  expirationHours: 168,
}

describe('validateEngagementInput', () => {
  it.each(['EP', 'Probate'] as const)('accepts an individual %s agreement', practiceArea => {
    expect(validateEngagementInput({ ...base, practiceArea })).toMatchObject({ ok: true })
  })

  it.each(['EP', 'Probate'] as const)('accepts a couple %s agreement', practiceArea => {
    expect(validateEngagementInput({
      ...base,
      practiceArea,
      clientMode: 'couple',
      spouse: { name: 'Sam Client', email: 'sam@example.com' },
    })).toMatchObject({ ok: true })
  })

  it.each(['MetLife', 'LegalEase', 'ARAG'] as const)('accepts individual and couple EP-LP agreements for %s', legalPlan => {
    expect(validateEngagementInput({ ...base, practiceArea: 'EP-LP', legalPlan })).toMatchObject({ ok: true })
    expect(validateEngagementInput({
      ...base,
      practiceArea: 'EP-LP',
      clientMode: 'couple',
      spouse: { name: 'Sam Client', email: 'sam@example.com' },
      legalPlan,
    })).toMatchObject({ ok: true })
  })

  it('normalizes names, emails, and text fields', () => {
    const result = validateEngagementInput({
      ...base,
      primary: { name: '  Alex Client  ', email: '  ALEX@EXAMPLE.COM  ' },
      fee: { ...base.fee, paymentTerms: '  Due on signing  ' },
      scopeKey: '  standard  ',
      emailMessage: '  Please review and sign.  ',
    })

    expect(result).toEqual({
      ok: true,
      value: {
        ...base,
        primary: { name: 'Alex Client', email: 'alex@example.com' },
      },
    })
  })

  it('requires spouse name and email for couples', () => {
    expect(validateEngagementInput({ ...base, clientMode: 'couple' })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['spouse']),
    })
    expect(validateEngagementInput({
      ...base,
      clientMode: 'couple',
      spouse: { name: '', email: 'invalid' },
    })).toMatchObject({ ok: false, errors: expect.arrayContaining(['spouse.name', 'spouse.email']) })
  })

  it('requires null spouse for individuals', () => {
    expect(validateEngagementInput({ ...base, spouse: { name: 'Sam', email: 'sam@example.com' } })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['spouse']),
    })
  })

  it('requires a recognized legal plan only for EP-LP', () => {
    expect(validateEngagementInput({ ...base, practiceArea: 'EP-LP' })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['legalPlan']),
    })
    expect(validateEngagementInput({ ...base, practiceArea: 'EP-LP', legalPlan: 'Other' })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['legalPlan']),
    })
    expect(validateEngagementInput({ ...base, legalPlan: 'MetLife' })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['legalPlan']),
    })
  })

  it.each([
    ['practiceArea', { practiceArea: 'Tax' }],
    ['clientMode', { clientMode: 'family' }],
    ['agreementDate', { agreementDate: '07/11/2026' }],
    ['agreementDate', { agreementDate: '2026-02-30' }],
    ['primary.name', { primary: { name: ' ', email: 'alex@example.com' } }],
    ['primary.email', { primary: { name: 'Alex', email: 'not-an-email' } }],
    ['fee.amount', { fee: { amount: 0, paymentTerms: 'Due' } }],
    ['fee.amount', { fee: { amount: Number.POSITIVE_INFINITY, paymentTerms: 'Due' } }],
    ['fee.paymentTerms', { fee: { amount: 5000, paymentTerms: ' ' } }],
    ['expirationHours', { expirationHours: 0 }],
    ['expirationHours', { expirationHours: Number.NaN }],
    ['scopeKey', { scopeKey: 'custom' }],
    ['optionalClauseKeys', { optionalClauseKeys: ['unapproved'] }],
  ])('rejects invalid %s', (error, override) => {
    expect(validateEngagementInput({ ...base, ...override })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([error]),
    })
  })
})
