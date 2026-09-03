/**
 * Estate tax calculation for the app.
 *
 * The figures themselves live in `lib/estateTaxSchedules.ts` as dated data with
 * their sources — this module is the thin layer that resolves which schedule
 * applies and hands it to the arithmetic. It used to hard-code the whole
 * Massachusetts rate table with the exemption in a comment and no effective
 * date, which is why nothing ever noticed a figure going stale.
 */
import {
  federalEstateTax,
  massachusettsEstateTax,
  massachusettsEstateTaxWithCreditShelter,
  resolveScheduleAsOf,
  todayIso,
  BUNDLED_FEDERAL_SCHEDULES,
  BUNDLED_MA_SCHEDULES,
  MA_SCHEDULE_2023,
  type FederalEstateTaxSchedule,
  type MassachusettsEstateTaxSchedule,
  type ScheduleLookup,
} from '@/lib/estateTaxSchedules'

export type {
  EstateTaxBracket,
  FederalEstateTaxSchedule,
  MassachusettsEstateTaxSchedule,
  ScheduleLookup,
} from '@/lib/estateTaxSchedules'

/**
 * The Massachusetts schedule in force on a date.
 *
 * H.4104 carries no sunset, so the bundled schedule is open-ended and this
 * resolves for any date from 2023 onward. If the legislature changes the table,
 * no code can detect that on its own — which is why the schedule carries its
 * `source` and `effectiveFrom` for a human to check, and why the figures are
 * overridable from `firm_settings` rather than only by a deploy.
 */
export function massachusettsScheduleAsOf(
  asOf: string = todayIso(),
  schedules: MassachusettsEstateTaxSchedule[] = BUNDLED_MA_SCHEDULES,
): ScheduleLookup<MassachusettsEstateTaxSchedule> {
  return resolveScheduleAsOf(schedules, asOf)
}

/**
 * The federal schedule in force on a date, which may legitimately be none.
 *
 * The basic exclusion amount is indexed and changes most years, so each
 * schedule's window is one year and a date past the newest one returns a miss.
 * Callers must decide what to show — the honest answer is "not on file", never
 * last year's number.
 */
export function federalScheduleAsOf(
  asOf: string = todayIso(),
  schedules: FederalEstateTaxSchedule[] = BUNDLED_FEDERAL_SCHEDULES,
): ScheduleLookup<FederalEstateTaxSchedule> {
  return resolveScheduleAsOf(schedules, asOf)
}

/** Estate value at which the Massachusetts credit stops covering the tentative tax. */
export const MA_ESTATE_TAX_EXEMPTION = MA_SCHEDULE_2023.exemption

export function calculateMAEstateTax(
  grossEstate: number,
  schedule: MassachusettsEstateTaxSchedule = MA_SCHEDULE_2023,
): number {
  return massachusettsEstateTax(grossEstate, schedule)
}

/**
 * The same tax with a credit-shelter plan in place. A two-trust plan parks the
 * first spouse's exemption in the shelter trust, so only what is left is taxed
 * at the second death.
 */
export function calculateMAEstateTaxWithCreditShelter(
  grossEstate: number,
  schedule: MassachusettsEstateTaxSchedule = MA_SCHEDULE_2023,
): number {
  return massachusettsEstateTaxWithCreditShelter(grossEstate, schedule)
}

export interface PortfolioEstateTaxes {
  massachusetts: number
  /**
   * Null when the firm has no federal schedule on file for the date — the
   * caller shows that rather than a number. `federalLookup` says why, and how
   * stale the newest figure on file is.
   */
  federal: number | null
  federalLookup: ScheduleLookup<FederalEstateTaxSchedule>
}

export function estimatePortfolioEstateTaxes(
  grossEstate: number,
  options?: {
    married?: boolean
    asOf?: string
    maSchedules?: MassachusettsEstateTaxSchedule[]
    federalSchedules?: FederalEstateTaxSchedule[]
  },
): PortfolioEstateTaxes {
  const asOf = options?.asOf ?? todayIso()
  const ma = massachusettsScheduleAsOf(asOf, options?.maSchedules)
  const federal = federalScheduleAsOf(asOf, options?.federalSchedules)

  return {
    massachusetts: ma.ok ? massachusettsEstateTax(grossEstate, ma.schedule) : 0,
    federal: federal.ok
      ? federalEstateTax(grossEstate, federal.schedule, { married: options?.married })
      : null,
    federalLookup: federal,
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
