// Massachusetts Estate Tax (2023+ rates)
// Exemption: $2,000,000 (via $99,600 credit)
// Source: MGL Ch. 65C, as amended by H.4104 (effective Jan 1, 2023)

function tentativeTax(adj: number): number {
  if (adj <= 40000) return 0
  if (adj <= 90000) return (adj - 40000) * 0.008
  if (adj <= 140000) return 400 + (adj - 90000) * 0.016
  if (adj <= 240000) return 1200 + (adj - 140000) * 0.024
  if (adj <= 440000) return 3600 + (adj - 240000) * 0.032
  if (adj <= 640000) return 10000 + (adj - 440000) * 0.04
  if (adj <= 840000) return 18000 + (adj - 640000) * 0.048
  if (adj <= 1040000) return 27600 + (adj - 840000) * 0.056
  if (adj <= 1540000) return 38800 + (adj - 1040000) * 0.064
  if (adj <= 2040000) return 70800 + (adj - 1540000) * 0.072
  if (adj <= 2540000) return 106800 + (adj - 2040000) * 0.08
  if (adj <= 3040000) return 146800 + (adj - 2540000) * 0.088
  if (adj <= 3540000) return 190800 + (adj - 3040000) * 0.096
  if (adj <= 4040000) return 238800 + (adj - 3540000) * 0.104
  if (adj <= 5040000) return 290800 + (adj - 4040000) * 0.112
  if (adj <= 6040000) return 402800 + (adj - 5040000) * 0.12
  if (adj <= 7040000) return 522800 + (adj - 6040000) * 0.128
  if (adj <= 8040000) return 650800 + (adj - 7040000) * 0.136
  if (adj <= 9040000) return 786800 + (adj - 8040000) * 0.144
  if (adj <= 10040000) return 930800 + (adj - 9040000) * 0.152
  return 1082800 + (adj - 10040000) * 0.16
}

/** Estate value at which the $99,600 credit stops covering the tentative tax. */
export const MA_ESTATE_TAX_EXEMPTION = 2_000_000

export function calculateMAEstateTax(grossEstate: number): number {
  const adjusted = grossEstate - 60000
  if (adjusted <= 0) return 0
  return Math.max(0, tentativeTax(adjusted) - 99600)
}

/**
 * The same tax, with a credit-shelter plan in place. A two-trust plan parks the
 * first spouse's $2,000,000 exemption in the shelter trust, so only what is
 * left is taxed at the second death. Reuses the credit table above rather than
 * restating any of it.
 */
export function calculateMAEstateTaxWithCreditShelter(grossEstate: number): number {
  return calculateMAEstateTax(Math.max(0, grossEstate - MA_ESTATE_TAX_EXEMPTION))
}

/** IRS basic exclusion amount (indexed annually). 2025 figure. */
export const FEDERAL_ESTATE_TAX_EXEMPTION = 13_990_000
export const FEDERAL_ESTATE_TAX_RATE = 0.40

export function calculateFederalEstateTax(
  grossEstate: number,
  options?: { exemption?: number },
): number {
  const exemption = options?.exemption ?? FEDERAL_ESTATE_TAX_EXEMPTION
  const taxable = Math.max(0, grossEstate - exemption)
  return Math.round(taxable * FEDERAL_ESTATE_TAX_RATE)
}

export function estimatePortfolioEstateTaxes(
  grossEstate: number,
  options?: { married?: boolean },
): { federal: number; massachusetts: number } {
  const federalExemption = options?.married
    ? FEDERAL_ESTATE_TAX_EXEMPTION * 2
    : FEDERAL_ESTATE_TAX_EXEMPTION
  return {
    federal: calculateFederalEstateTax(grossEstate, { exemption: federalExemption }),
    massachusetts: calculateMAEstateTax(grossEstate),
  }
}

export const ASSET_CATEGORIES = [
  { key: 'real_estate',        label: 'Real Estate' },
  { key: 'bank',               label: 'Bank Accounts' },
  { key: 'investment',         label: 'Non-Retirement Accounts' },
  { key: 'retirement',         label: 'Retirement Accounts' },
  { key: 'life_insurance',     label: 'Life Insurance' },
  { key: 'business',           label: 'Business Interests' },
  { key: 'vehicles',           label: 'Vehicles' },
  { key: 'personal_property',  label: 'Personal Property' },
  { key: 'inheritance',        label: 'Anticipated Inheritance' },
  { key: 'crypto',             label: 'Cryptocurrencies' },
  { key: 'other',              label: 'Other Assets' },
] as const

export type AssetCategory = typeof ASSET_CATEGORIES[number]['key']
export type Ownership = 'client' | 'spouse' | 'joint'

export type FieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  options?: string[]
  placeholder?: string
}

export type CategoryConfig = {
  valueLabel: string
  descriptionLabel: string
  extraFields: FieldDef[]
}

export const CATEGORY_DETAILS: Partial<Record<string, CategoryConfig>> = {
  real_estate: {
    valueLabel: 'Estimated Value',
    descriptionLabel: 'Property Address',
    extraFields: [
      { key: 'property_type', label: 'Property Type', type: 'select', options: ['Primary Residence', 'Vacation Home', 'Rental Property', 'Commercial', 'Land / Lot'] },
      { key: 'mortgage_balance', label: 'Mortgage Balance', type: 'number', placeholder: '0' },
    ],
  },
  bank: {
    valueLabel: 'Balance',
    descriptionLabel: 'Account Name / Last 4',
    extraFields: [
      { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g. Bank of America' },
      { key: 'account_type', label: 'Account Type', type: 'select', options: ['Checking', 'Savings', 'Money Market', 'CD', 'Other'] },
      { key: 'beneficiary', label: 'Beneficiary', type: 'text', placeholder: 'Name or Estate' },
    ],
  },
  investment: {
    valueLabel: 'Account Value',
    descriptionLabel: 'Account Name / Last 4',
    extraFields: [
      { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g. Fidelity' },
      { key: 'account_type', label: 'Account Type', type: 'select', options: ['Brokerage', 'Individual', 'Joint', 'Trust', 'Other'] },
      { key: 'beneficiary', label: 'Beneficiary', type: 'text', placeholder: 'Name or Estate' },
    ],
  },
  retirement: {
    valueLabel: 'Account Value',
    descriptionLabel: 'Account Name / Last 4',
    extraFields: [
      { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g. Fidelity' },
      { key: 'account_type', label: 'Account Type', type: 'select', options: ['401(k)', '403(b)', 'IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', 'Pension', 'Other'] },
      { key: 'beneficiary', label: 'Beneficiary', type: 'text', placeholder: 'Name or Estate' },
    ],
  },
  life_insurance: {
    valueLabel: 'Death Benefit',
    descriptionLabel: 'Policy Name / Number',
    extraFields: [
      { key: 'institution', label: 'Insurance Company', type: 'text', placeholder: 'e.g. MetLife' },
      { key: 'insured', label: 'Insured', type: 'text', placeholder: 'Name of insured' },
      { key: 'account_type', label: 'Policy Type', type: 'select', options: ['Term', 'Whole Life', 'Universal Life', 'Variable', 'Other'] },
      { key: 'beneficiary', label: 'Beneficiary', type: 'text', placeholder: 'Name or Estate' },
    ],
  },
  inheritance: {
    valueLabel: 'Expected Value',
    descriptionLabel: 'Description',
    extraFields: [
      { key: 'from_whom', label: 'From Whom', type: 'text', placeholder: 'e.g. Parent, relative' },
      { key: 'timeline', label: 'Expected Timeline', type: 'text', placeholder: 'e.g. 5–10 years' },
    ],
  },
  crypto: {
    valueLabel: 'Current Value',
    descriptionLabel: 'Coin / Token',
    extraFields: [
      { key: 'institution', label: 'Exchange / Wallet', type: 'text', placeholder: 'e.g. Coinbase, hardware wallet' },
    ],
  },
}

export interface Asset {
  id?: string
  client_intake_id?: string
  category: string
  description: string
  value: number
  ownership: Ownership
  details?: Record<string, string | number>
}
