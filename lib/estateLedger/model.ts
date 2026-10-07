import { centsToDecimal } from '@/lib/payroll/money'

/**
 * The fiduciary ledger for a probate estate: the inventory, what happened
 * after death, and the account the two produce. Pure, so the arithmetic a
 * court account rests on is tested without a database.
 *
 * The account follows the usual fiduciary layout:
 *
 *   inventory at date-of-death value
 *   + receipts
 *   + gains on sale        (net proceeds above the inventory value)
 *   − losses on sale       (net proceeds below it)
 *   − disbursements        (expenses, taxes, claims, fees)
 *   − distributions        (cash, and assets in kind at inventory value)
 *   = balance on hand
 *
 * and the balance is proved by what is actually held: cash, plus the inventory
 * assets neither sold nor distributed. Principal and income are kept apart,
 * as a fiduciary account keeps them; an inventory asset, a sale and an in-kind
 * distribution are always principal.
 */

export const ASSET_CATEGORIES = [
  'real_estate', 'bank', 'investment', 'retirement', 'insurance', 'vehicle', 'personal_property', 'business', 'receivable', 'other',
] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  real_estate: 'Real estate',
  bank: 'Bank account',
  investment: 'Investment account',
  retirement: 'Retirement account',
  insurance: 'Life insurance',
  vehicle: 'Vehicle',
  personal_property: 'Personal property',
  business: 'Business interest',
  receivable: 'Money owed to the decedent',
  other: 'Other',
}

export const ENTRY_KINDS = ['receipt', 'disbursement', 'sale', 'distribution'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  receipt: 'Receipt',
  disbursement: 'Disbursement',
  sale: 'Sale of an asset',
  distribution: 'Distribution',
}

export const FUNDS = ['principal', 'income'] as const
export type Fund = (typeof FUNDS)[number]

export interface EstateAsset {
  id: string
  matterId: string
  description: string
  category: AssetCategory
  probate: boolean
  dateOfDeathValueCents: number
  valuationNote: string | null
}

export interface LedgerEntry {
  id: string
  matterId: string
  entryDate: string
  kind: EntryKind
  fund: Fund
  amountCents: number
  description: string
  counterparty: string | null
  assetId: string | null
}

export class LedgerInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (required) throw new LedgerInputError(`${field} is required`)
    return null
  }
  if (typeof value !== 'string') throw new LedgerInputError(`${field} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new LedgerInputError(`${field} is longer than ${max} characters`)
  return trimmed
}

function cents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new LedgerInputError(`${field} must be a whole number of cents, zero or more`)
  }
  return value
}

export interface AssetInput {
  description: string
  category: AssetCategory
  probate: boolean
  dateOfDeathValueCents: number
  valuationNote: string | null
}

export function parseAssetInput(body: Record<string, unknown>): AssetInput {
  const category = body.category ?? 'other'
  if (!(ASSET_CATEGORIES as readonly unknown[]).includes(category)) throw new LedgerInputError('category is not one of the asset categories')
  if (body.probate !== undefined && typeof body.probate !== 'boolean') throw new LedgerInputError('probate must be true or false')
  return {
    description: text(body.description, 'description', 500, true)!,
    category: category as AssetCategory,
    probate: body.probate !== false,
    dateOfDeathValueCents: cents(body.dateOfDeathValueCents ?? 0, 'dateOfDeathValueCents'),
    valuationNote: text(body.valuationNote, 'valuationNote', 1000, false),
  }
}

export interface EntryInput {
  entryDate: string
  kind: EntryKind
  fund: Fund
  amountCents: number
  description: string
  counterparty: string | null
  assetId: string | null
}

/**
 * An entry, checked against the inventory and the entries already made: a
 * sale or in-kind distribution names a probate asset still on hand, an in-kind
 * distribution moves it at its inventory value, and anything touching an
 * asset is principal.
 */
export function parseEntryInput(
  body: Record<string, unknown>,
  assets: readonly EstateAsset[],
  entries: readonly LedgerEntry[],
): EntryInput {
  const kind = body.kind
  if (!(ENTRY_KINDS as readonly unknown[]).includes(kind)) throw new LedgerInputError('kind must be receipt, disbursement, sale or distribution')
  const entryDate = typeof body.entryDate === 'string' ? body.entryDate.trim() : ''
  if (!DATE.test(entryDate)) throw new LedgerInputError('entryDate must be a YYYY-MM-DD date')
  const fund = body.fund ?? 'principal'
  if (!(FUNDS as readonly unknown[]).includes(fund)) throw new LedgerInputError('fund must be principal or income')
  const assetId = typeof body.assetId === 'string' && body.assetId ? body.assetId : null

  let amountCents = cents(body.amountCents, 'amountCents')
  if (kind === 'receipt' || kind === 'disbursement') {
    if (assetId) throw new LedgerInputError(`A ${kind} does not name an inventory asset`)
  } else if (kind === 'sale' && !assetId) {
    throw new LedgerInputError('A sale names the inventory asset sold')
  }
  if (assetId) {
    const asset = assets.find(item => item.id === assetId)
    if (!asset) throw new LedgerInputError('That asset is not on this estate’s inventory')
    if (!asset.probate) throw new LedgerInputError('A non-probate asset is not part of the account')
    if (entries.some(entry => entry.assetId === assetId)) throw new LedgerInputError('That asset has already been sold or distributed')
    if (fund !== 'principal') throw new LedgerInputError('A sale or in-kind distribution is principal')
    if (kind === 'distribution') amountCents = asset.dateOfDeathValueCents
  }

  return {
    entryDate,
    kind: kind as EntryKind,
    fund: fund as Fund,
    amountCents,
    description: text(body.description, 'description', 500, true)!,
    counterparty: text(body.counterparty, 'counterparty', 200, false),
    assetId,
  }
}

export interface FundTotals {
  receipts: number
  gains: number
  losses: number
  disbursements: number
  distributions: number
}

export interface EstateAccount {
  /** Probate inventory at date-of-death value. */
  inventory: number
  /** Non-probate property listed, outside the account. */
  nonProbate: number
  principal: FundTotals & { balance: number }
  income: FundTotals & { balance: number }
  balance: number
  /** What makes up the balance. */
  onHand: { cash: number; assets: number; assetCount: number }
  /** True when cash plus assets on hand equals the balance, as it always should. */
  proves: boolean
  /** Cash below zero: more paid out than came in, so an entry is missing or wrong. */
  overdrawn: boolean
}

const emptyTotals = (): FundTotals => ({ receipts: 0, gains: 0, losses: 0, disbursements: 0, distributions: 0 })

export function computeAccount(assets: readonly EstateAsset[], entries: readonly LedgerEntry[]): EstateAccount {
  const probateAssets = assets.filter(asset => asset.probate)
  const byId = new Map(probateAssets.map(asset => [asset.id, asset]))
  const inventory = probateAssets.reduce((sum, asset) => sum + asset.dateOfDeathValueCents, 0)
  const nonProbate = assets.filter(asset => !asset.probate).reduce((sum, asset) => sum + asset.dateOfDeathValueCents, 0)
  const funds: Record<Fund, FundTotals> = { principal: emptyTotals(), income: emptyTotals() }
  let cash = 0
  const disposed = new Set<string>()

  for (const entry of entries) {
    const totals = funds[entry.fund]
    switch (entry.kind) {
      case 'receipt':
        totals.receipts += entry.amountCents
        cash += entry.amountCents
        break
      case 'disbursement':
        totals.disbursements += entry.amountCents
        cash -= entry.amountCents
        break
      case 'sale': {
        const asset = entry.assetId ? byId.get(entry.assetId) : undefined
        const carrying = asset?.dateOfDeathValueCents ?? 0
        const difference = entry.amountCents - carrying
        if (difference >= 0) totals.gains += difference
        else totals.losses += -difference
        cash += entry.amountCents
        if (entry.assetId) disposed.add(entry.assetId)
        break
      }
      case 'distribution':
        totals.distributions += entry.amountCents
        if (entry.assetId) disposed.add(entry.assetId)
        else cash -= entry.amountCents
        break
    }
  }

  const fundBalance = (totals: FundTotals, opening: number) =>
    opening + totals.receipts + totals.gains - totals.losses - totals.disbursements - totals.distributions
  const principal = { ...funds.principal, balance: fundBalance(funds.principal, inventory) }
  const income = { ...funds.income, balance: fundBalance(funds.income, 0) }
  const held = probateAssets.filter(asset => !disposed.has(asset.id))
  const onHand = { cash, assets: held.reduce((sum, asset) => sum + asset.dateOfDeathValueCents, 0), assetCount: held.length }
  const balance = principal.balance + income.balance
  return {
    inventory,
    nonProbate,
    principal,
    income,
    balance,
    onHand,
    proves: onHand.cash + onHand.assets === balance,
    overdrawn: cash < 0,
  }
}

/** Entries in the order an account lists them: by date, then as recorded. */
export function sortEntries<T extends Pick<LedgerEntry, 'entryDate'>>(entries: readonly T[]): T[] {
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate) || a.index - b.index)
    .map(({ entry }) => entry)
}

function csvCell(value: string): string {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The ledger as a CSV: the inventory, every entry, then the account totals. */
export function ledgerCsv(assets: readonly EstateAsset[], entries: readonly LedgerEntry[]): string {
  const account = computeAccount(assets, entries)
  const assetName = new Map(assets.map(asset => [asset.id, asset.description]))
  const rows: string[][] = [['Section', 'Date', 'Type', 'Fund', 'Description', 'Counterparty or asset', 'Amount']]
  for (const asset of assets) {
    rows.push(['Inventory', '', ASSET_CATEGORY_LABELS[asset.category], asset.probate ? 'principal' : 'non-probate', asset.description, asset.valuationNote ?? '', centsToDecimal(asset.dateOfDeathValueCents)])
  }
  for (const entry of sortEntries(entries)) {
    rows.push(['Entry', entry.entryDate, ENTRY_KIND_LABELS[entry.kind], entry.fund, entry.description, entry.assetId ? assetName.get(entry.assetId) ?? '' : entry.counterparty ?? '', centsToDecimal(entry.amountCents)])
  }
  const totals: Array<[string, number]> = [
    ['Inventory (probate)', account.inventory],
    ['Principal receipts', account.principal.receipts],
    ['Gains on sale', account.principal.gains],
    ['Losses on sale', account.principal.losses],
    ['Principal disbursements', account.principal.disbursements],
    ['Principal distributions', account.principal.distributions],
    ['Principal balance', account.principal.balance],
    ['Income receipts', account.income.receipts],
    ['Income disbursements', account.income.disbursements],
    ['Income distributions', account.income.distributions],
    ['Income balance', account.income.balance],
    ['Balance on hand', account.balance],
    ['Cash on hand', account.onHand.cash],
    ['Assets on hand at inventory value', account.onHand.assets],
  ]
  for (const [label, amount] of totals) rows.push(['Account', '', '', '', label, '', centsToDecimal(amount)])
  return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n'
}
