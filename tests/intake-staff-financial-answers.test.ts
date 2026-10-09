import { expect, it } from 'vitest'
import { financialEditValue, mergeStaffFinancialAnswers, withStaffFinancialAnswers } from '@/lib/intake/forms/staffFinancialAnswers'

const property = { id: 'property', type: 'Residential', address: 'Old address', owner: 'Client', value: 'Approx. $500,000', mortgage: '', notes: '' }
it('merges changed lists by ID, preserving metadata and unrelated financial answers', () => {
  const stored = { real_estate: [{ ...property, imported: { source: 'legacy' } }, { ...property, id: 'removed' }], unknown: { keep: true }, bank_accounts: { client_total: '100' } }
  const result = mergeStaffFinancialAnswers({ real_estate: [{ ...property, address: 'New address' }, { ...property, id: 'added' }] }, stored)
  expect(result).toEqual({ ...stored, real_estate: [{ ...property, address: 'New address', imported: { source: 'legacy' } }, { ...property, id: 'added' }] })
  expect(stored.real_estate[0].address).toBe('Old address')
})
it('preserves totals metadata, circumstance metadata, and unchecked asset details', () => {
  const stored = { bank_accounts: { client_total: '1', source: 'preserve' }, circumstance_details: { has_prior_marriage: 'Before', unknown: 'Preserve' }, real_estate: [property] }
  expect(mergeStaffFinancialAnswers({ bank_accounts: { client_total: '2', spouse_total: '', joint_total: '' }, circumstance_details: { has_prior_marriage: 'After' }, asset_types: [] }, stored)).toEqual({ ...stored,
    bank_accounts: { client_total: '2', spouse_total: '', joint_total: '', source: 'preserve' },
    circumstance_details: { has_prior_marriage: 'After', unknown: 'Preserve' }, asset_types: [],
  })
})
it('projects changed UI keys without forwarding stored metadata', () => {
  expect(financialEditValue({ financial_real_estate: [{ ...property, imported: true }], financial_bank_accounts: { client_total: '2', source: 'old' }, asset_types: ['real_estate'], financial_circumstance_details: { has_prior_marriage: 'Yes', unknown: 'Keep server-side' } })).toEqual({
    real_estate: [property], bank_accounts: { client_total: '2', spouse_total: '', joint_total: '' }, asset_types: ['real_estate'], circumstance_details: { has_prior_marriage: 'Yes' },
  })
})
it('unpacks nested financial answers without replacing hydrated contacts', () => {
  const data = { financial_details: { asset_types: ['real_estate'], real_estate: [property], has_prior_marriage: true }, _spouse: { first_name: 'Hydrated' } }
  expect(withStaffFinancialAnswers(data)).toMatchObject({ asset_types: ['real_estate'], financial_real_estate: [property], has_prior_marriage: true, _spouse: data._spouse })
})
it.each([
  null, [], { arbitrary_column: 'bad' }, { asset_types: ['invented'] }, { asset_types: ['real_estate', 'real_estate'] },
  { real_estate: [property, property] }, { real_estate: [{ ...property, imported: 'tampered' }] },
  { real_estate: [{ ...property, value: {} }] }, { real_estate: Array.from({ length: 101 }, (_, i) => ({ ...property, id: String(i) })) },
  { bank_accounts: 'bad' }, { bank_accounts: { client_total: '1', spouse_total: '', joint_total: '', source: 'injected' } },
  { has_prior_marriage: 'yes' }, { circumstance_details: { unknown: 'tampered' } }, { other_assets: {} }, { personal_property: 'x'.repeat(20001) },
])('rejects invalid or overreaching financial patches %#', value => {
  expect(() => mergeStaffFinancialAnswers(value, {})).toThrow()
})
it.each([
  [{ real_estate: [] }, { real_estate: [{ address: 'Missing id' }] }],
  [{ real_estate: [] }, { real_estate: [property, property] }],
  [{ bank_accounts: { client_total: '', spouse_total: '', joint_total: '' } }, { bank_accounts: 'legacy string' }],
  [{ circumstance_details: {} }, { circumstance_details: [] }],
  [{}, 'malformed'],
])('fails closed when changed saved data cannot be safely merged %#', (value, stored) => {
  expect(() => mergeStaffFinancialAnswers(value, stored)).toThrow('review')
})
it('accepts blank draft entries, approximate amounts and explicit removals', () => {
  expect(mergeStaffFinancialAnswers({ real_estate: [], other_assets: '', expects_inheritance: false, business_interests: [{ id: 'b', name: '', business_type: '', interest_pct: '', value: 'Not sure', owner: '' }], liabilities: [{ id: 'l', description: '', value: '', owner: '' }] }, null)).toMatchObject({ real_estate: [], other_assets: '', expects_inheritance: false })
})
