import { describe, expect, it } from 'vitest'
import { validateEngagementInput } from '@/lib/engagement/schema'
import { ENGAGEMENT_LEGAL_PLANS } from '@/lib/engagement/types'

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
  it('accepts an individual EP agreement', () => {
    expect(validateEngagementInput(base)).toMatchObject({ ok: true })
  })

  it('accepts a probate agreement, which names the estate it administers', () => {
    expect(validateEngagementInput({ ...base, practiceArea: 'Probate', decedentName: 'Rosemary Decedent' }))
      .toMatchObject({ ok: true })
  })

  it.each([
    ['a probate agreement with no estate named', { practiceArea: 'Probate' as const }],
    // Only the probate master prints an "Estate of" line; anywhere else the
    // name would be carried in the snapshot and rendered nowhere.
    ['an estate on an agreement that prints none', { decedentName: 'Rosemary Decedent' }],
  ])('rejects %s', (_case, patch) => {
    expect(validateEngagementInput({ ...base, ...patch })).toMatchObject({ ok: false, errors: ['decedentName'] })
  })

  it.each(['EP', 'Probate'] as const)('accepts a couple %s agreement', practiceArea => {
    expect(validateEngagementInput({
      ...base,
      practiceArea,
      clientMode: 'couple',
      spouse: { name: 'Sam Client', email: 'sam@example.com' },
    })).toMatchObject({ ok: true })
  })

  // Plans are the firm's own billing types, so a plan the Billing tab accepts
  // is a plan an engagement can name.
  it.each(ENGAGEMENT_LEGAL_PLANS)('accepts individual and couple EP-LP agreements for %s', legalPlan => {
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
        additionalClauses: [],
        scheduleAClauses: [],
        decedentName: null,
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

  it.each(['unapproved', null, { 0: 'unapproved' }])(
    'rejects an explicitly supplied non-array optionalClauseKeys container (%j)',
    optionalClauseKeys => {
      expect(validateEngagementInput({ ...base, optionalClauseKeys })).toMatchObject({
        ok: false,
        errors: expect.arrayContaining(['optionalClauseKeys']),
      })
    },
  )

  it('defaults a genuinely omitted optionalClauseKeys value to an empty array', () => {
    const { optionalClauseKeys: _omitted, ...withoutOptionalClauseKeys } = base

    expect(validateEngagementInput(withoutOptionalClauseKeys)).toMatchObject({
      ok: true,
      value: { optionalClauseKeys: [] },
    })
  })
})
