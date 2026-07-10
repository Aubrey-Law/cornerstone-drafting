import { ASSET_CATEGORIES, type AssetCategory, type Ownership } from '@/lib/estateTax'
import { mapImportedAssetCategory } from '@/lib/import/mapAssetCategory'

export interface ParsedSpreadsheetAsset {
  category: AssetCategory
  description: string
  value: number
  ownership: Ownership
  details: Record<string, string | number>
}

const LABEL_TO_CATEGORY = Object.fromEntries(
  ASSET_CATEGORIES.map(cat => [cat.label.toLowerCase(), cat.key]),
) as Record<string, AssetCategory>

/** Section titles used by Lawmatics / financial-information exports. */
const EXTRA_LABEL_ALIASES: Record<string, AssetCategory> = {
  'real property': 'real_estate',
  'bank accounts': 'bank',
  'investment accounts': 'investment',
  'non-retirement accounts': 'investment',
  'stock bonds brokerage accounts': 'investment',
  'retirement accounts': 'retirement',
  'life insurance': 'life_insurance',
  'business interests': 'business',
  'business you own': 'business',
  'personal property': 'personal_property',
  'household tangible personal property': 'personal_property',
  'anticipated inheritance': 'inheritance',
  'anticipated inheritance gift or judgment': 'inheritance',
  cryptocurrencies: 'crypto',
  'other assets': 'other',
  'custodial accounts': 'other',
  annuities: 'other',
  'loan receivable to you': 'other',
  'safe deposit box': 'other',
  vehicles: 'vehicles',
  'vehicles and other titled moving property': 'vehicles',
}

const HEADER_ALIASES: Record<string, string> = {
  category: 'category',
  asset_type: 'category',
  'asset type': 'category',
  description: 'description',
  asset: 'description',
  name: 'description',
  address: 'description',
  ownership: 'ownership',
  owner: 'ownership',
  value: 'value',
  amount: 'value',
  balance: 'value',
  estimated_value: 'value',
  'estimated value': 'value',
  property_type: 'property_type',
  'property type': 'property_type',
  mortgage_balance: 'mortgage_balance',
  'mortgage balance': 'mortgage_balance',
  'outstanding debt': 'mortgage_balance',
  institution: 'institution',
  bank: 'institution',
  'insurance company': 'institution',
  account_type: 'account_type',
  'account type': 'account_type',
  beneficiary: 'beneficiary',
  beneficiaries: 'beneficiary',
  insured: 'insured',
  from_whom: 'from_whom',
  'from whom': 'from_whom',
  timeline: 'timeline',
  'expected timeline': 'timeline',
  exchange_wallet: 'institution',
  'exchange/wallet': 'institution',
  'account number': 'account_number',
  account_number: 'account_number',
  'business name': 'description',
  'make model year': 'description',
  vin: 'vin',
  ein: 'ein',
  'ownership percent': 'ownership_percent',
}

const SKIP_ROW_PATTERN =
  /^(summary|grand total|client owned|spouse owned|joint owned|ma estate tax|total estate|estimated ma|subtotal|note:|estate is below|exported|category totals)/i

const DETAIL_KEYS = [
  'property_type',
  'mortgage_balance',
  'institution',
  'account_type',
  'account_number',
  'beneficiary',
  'insured',
  'from_whom',
  'timeline',
  'vin',
  'ein',
  'ownership_percent',
] as const

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^\w\s/]+/g, '').replace(/\s+/g, ' ').trim()
}

function mapHeader(raw: string): string | null {
  const normalized = normalizeHeader(raw)
  if (!normalized || normalized === 'net') return null
  if (HEADER_ALIASES[normalized]) return HEADER_ALIASES[normalized]
  const snake = normalized.replace(/\s+/g, '_').replace(/\//g, '_')
  return HEADER_ALIASES[snake] ?? snake
}

export function cellToString(cell: unknown): string {
  if (cell == null) return ''
  if (typeof cell === 'string') return cell.trim()
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  if (typeof cell === 'object') {
    const obj = cell as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text.trim()
    if ('result' in obj) return cellToString(obj.result)
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>)
        .map(part => part.text ?? '')
        .join('')
        .trim()
    }
    return ''
  }
  return String(cell).trim()
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function resolveSectionCategory(raw: string): AssetCategory | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const labelKey = normalizeHeader(trimmed)
  if (LABEL_TO_CATEGORY[trimmed.toLowerCase()]) return LABEL_TO_CATEGORY[trimmed.toLowerCase()]
  if (LABEL_TO_CATEGORY[labelKey]) return LABEL_TO_CATEGORY[labelKey]
  if (EXTRA_LABEL_ALIASES[trimmed.toLowerCase()]) return EXTRA_LABEL_ALIASES[trimmed.toLowerCase()]
  if (EXTRA_LABEL_ALIASES[labelKey]) return EXTRA_LABEL_ALIASES[labelKey]

  const mapped = mapImportedAssetCategory(trimmed)
  // mapImportedAssetCategory falls back to 'other' for unknown strings — only treat
  // known keys / explicit aliases as section titles.
  const key = trimmed.toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')
  const known =
    mapped !== 'other' ||
    key === 'other' ||
    key === 'other_assets' ||
    Boolean(EXTRA_LABEL_ALIASES[labelKey])
  return known ? mapped : null
}

function mapCategory(raw: string): AssetCategory {
  const trimmed = raw.trim()
  if (!trimmed) return 'other'

  const section = resolveSectionCategory(trimmed)
  if (section) return section

  const withoutSubtotal = trimmed.toLowerCase().replace(/\s+subtotal$/, '')
  return resolveSectionCategory(withoutSubtotal) ?? mapImportedAssetCategory(trimmed)
}

function mapOwnership(raw: string): Ownership {
  const v = raw.trim().toLowerCase()
  if (!v || v === 'primary' || v === 'client' || v.includes('client')) return 'client'
  if (v.includes('spouse')) return 'spouse'
  if (v.includes('joint')) return 'joint'
  return 'client'
}

function shouldSkipRow(cells: string[]): boolean {
  const joined = cells.map(c => c.trim()).filter(Boolean).join(' ')
  if (!joined) return true
  if (SKIP_ROW_PATTERN.test(joined)) return true
  if (/subtotal$/i.test(cells[0]?.trim() ?? '')) return true
  return false
}

function isSectionTitleRow(cells: string[]): AssetCategory | null {
  const first = cells[0]?.trim() ?? ''
  if (!first) return null
  const restEmpty = cells.slice(1).every(c => !c.trim())
  if (!restEmpty) return null
  if (/^category totals$/i.test(first) || /^total$/i.test(first)) return null
  return resolveSectionCategory(first)
}

function isFinancialHeaderRow(cells: string[]): boolean {
  const mapped = cells.map(mapHeader)
  const hasOwner = mapped.includes('ownership')
  const hasValue = mapped.includes('value')
  return hasOwner && hasValue
}

function isFinancialSummaryFormat(rows: string[][]): boolean {
  let sectionHits = 0
  for (const row of rows.slice(0, 100)) {
    const cells = row.map(cellToString)
    const first = cells[0]?.trim() ?? ''
    if (/^category totals$/i.test(first)) return true
    if (isSectionTitleRow(cells)) {
      sectionHits += 1
      if (sectionHits >= 2) return true
    }
  }
  return false
}

function mapFinancialHeader(raw: string, category: AssetCategory): string | null {
  const normalized = normalizeHeader(raw)
  if (!normalized || normalized === 'net') return null
  if (normalized === 'type') {
    return category === 'real_estate' ? 'property_type' : 'account_type'
  }
  if (normalized === 'ownership') return 'ownership_percent'
  return mapHeader(raw)
}

function buildDescription(record: Record<string, string>, category: AssetCategory): string {
  const explicit = (record.description ?? '').trim()
  if (explicit) return explicit

  const institution = (record.institution ?? '').trim()
  const accountType = (record.account_type ?? '').trim()
  const accountNumber = (record.account_number ?? '').trim()
  const parts = [institution, accountType].filter(Boolean)
  if (accountNumber) parts.push(`(${accountNumber})`)
  if (parts.length > 0) return parts.join(' ')

  const propertyType = (record.property_type ?? '').trim()
  if (propertyType) return propertyType

  if (category === 'investment') return 'Brokerage account'
  if (category === 'life_insurance') return 'Life insurance policy'
  return ''
}

function recordToAsset(
  record: Record<string, string>,
  category: AssetCategory,
): ParsedSpreadsheetAsset | null {
  const value = parseNumber(record.value ?? '')
  const mortgage = parseNumber(record.mortgage_balance ?? '')
  const description = buildDescription(record, category)
  const ownershipRaw = record.ownership ?? ''

  if (!description && !value && !mortgage && !ownershipRaw) return null

  // Skip pure section/totals noise that slipped through
  if (/^category totals$/i.test(description)) return null

  const details: Record<string, string | number> = {}
  for (const key of DETAIL_KEYS) {
    const val = record[key]
    if (!val) continue
    details[key] =
      key === 'mortgage_balance' || key === 'ownership_percent' ? parseNumber(val) : val
  }

  return {
    category,
    description: description || 'Imported asset',
    value,
    ownership: mapOwnership(ownershipRaw || 'client'),
    details,
  }
}

function parseFinancialSummaryRows(rows: string[][]): ParsedSpreadsheetAsset[] {
  const assets: ParsedSpreadsheetAsset[] = []
  let currentCategory: AssetCategory | null = null
  let headerMap: Array<string | null> | null = null

  for (const row of rows) {
    const cells = row.map(cellToString)
    const first = cells[0]?.trim() ?? ''

    if (/^category totals$/i.test(first) || /^total$/i.test(first)) break
    if (shouldSkipRow(cells) && !isSectionTitleRow(cells)) continue

    const section = isSectionTitleRow(cells)
    if (section) {
      currentCategory = section
      headerMap = null
      continue
    }

    // Liabilities are not imported as assets
    if (/^liabilities\b/i.test(first) && cells.slice(1).every(c => !c.trim())) {
      currentCategory = null
      headerMap = null
      continue
    }

    if (!currentCategory) continue

    if (isFinancialHeaderRow(cells)) {
      headerMap = cells.map(cell => mapFinancialHeader(cell, currentCategory!))
      continue
    }

    if (!headerMap) continue

    const record: Record<string, string> = {}
    headerMap.forEach((key, idx) => {
      if (!key) return
      // Don't overwrite ownership with a later empty ownership_percent column, etc.
      const next = cells[idx] ?? ''
      if (!next && record[key]) return
      record[key] = next
    })

    const asset = recordToAsset(record, currentCategory)
    if (asset) assets.push(asset)
  }

  return assets
}

function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const mapped = rows[i].map(mapHeader)
    if (mapped.includes('category') && mapped.includes('description') && mapped.includes('value')) {
      return i
    }
    if (mapped.includes('category') && mapped.includes('value')) return i
  }
  return rows.findIndex(row => row.some(cell => mapHeader(cell) === 'category'))
}

function parseFlatAssetRows(rows: string[][]): ParsedSpreadsheetAsset[] {
  const headerIndex = findHeaderRowIndex(rows)
  if (headerIndex < 0) {
    throw new Error('Could not find a header row with Category and Value columns')
  }

  const headerMap = rows[headerIndex].map(mapHeader)
  const assets: ParsedSpreadsheetAsset[] = []

  for (const row of rows.slice(headerIndex + 1)) {
    const cells = row.map(cellToString)
    if (shouldSkipRow(cells)) continue

    const record: Record<string, string> = {}
    headerMap.forEach((key, idx) => {
      if (!key) return
      record[key] = cells[idx] ?? ''
    })

    const categoryRaw = record.category ?? ''
    const category = mapCategory(categoryRaw)
    const asset = recordToAsset(record, category)
    if (!asset) continue
    // Flat exports always have an explicit category column; keep prior behavior of
    // requiring category or description/value.
    if (!categoryRaw && !asset.description && !asset.value) continue
    assets.push({
      ...asset,
      description: asset.description === 'Imported asset' && categoryRaw
        ? categoryRaw
        : asset.description,
    })
  }

  return assets
}

/** Parse spreadsheet row matrices (CSV or XLSX cell strings) into assets. */
export function parseAssetSpreadsheetRows(rows: string[][]): ParsedSpreadsheetAsset[] {
  if (rows.length === 0) return []

  if (isFinancialSummaryFormat(rows)) {
    return parseFinancialSummaryRows(rows)
  }

  return parseFlatAssetRows(rows)
}
