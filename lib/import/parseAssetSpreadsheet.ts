import ExcelJS from 'exceljs'
import { ASSET_CATEGORIES, type AssetCategory, type Ownership } from '@/lib/estateTax'
import { mapImportedAssetCategory } from '@/lib/import/mapAssetCategory'
import { parseCsvRows } from '@/lib/import/parseCsvRows'

export const MAX_ASSET_SPREADSHEET_BYTES = 10 * 1024 * 1024

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CSV_MIME = 'text/csv'

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

const EXTRA_LABEL_ALIASES: Record<string, AssetCategory> = {
  'real property': 'real_estate',
  'bank accounts': 'bank',
  'investment accounts': 'investment',
  'non-retirement accounts': 'investment',
  'retirement accounts': 'retirement',
  'life insurance': 'life_insurance',
  'business interests': 'business',
  'personal property': 'personal_property',
  'anticipated inheritance': 'inheritance',
  'cryptocurrencies': 'crypto',
  'other assets': 'other',
}

const HEADER_ALIASES: Record<string, string> = {
  category: 'category',
  type: 'category',
  asset_type: 'category',
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
  property_type: 'property_type',
  'property type': 'property_type',
  mortgage_balance: 'mortgage_balance',
  'mortgage balance': 'mortgage_balance',
  institution: 'institution',
  bank: 'institution',
  'insurance company': 'institution',
  account_type: 'account_type',
  'account type': 'account_type',
  beneficiary: 'beneficiary',
  insured: 'insured',
  from_whom: 'from_whom',
  'from whom': 'from_whom',
  timeline: 'timeline',
  'expected timeline': 'timeline',
  exchange_wallet: 'institution',
  'exchange/wallet': 'institution',
}

const SKIP_ROW_PATTERN =
  /^(summary|grand total|client owned|spouse owned|joint owned|ma estate tax|total estate|estimated ma|subtotal|note:|estate is below)/i

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^\w\s/]+/g, '').replace(/\s+/g, ' ')
}

function mapHeader(raw: string): string | null {
  const normalized = normalizeHeader(raw)
  if (!normalized) return null
  if (HEADER_ALIASES[normalized]) return HEADER_ALIASES[normalized]
  const snake = normalized.replace(/\s+/g, '_').replace(/\//g, '_')
  return HEADER_ALIASES[snake] ?? snake
}

function cellToString(cell: unknown): string {
  if (cell == null) return ''
  if (typeof cell === 'string') return cell.trim()
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  if (typeof cell === 'object' && 'text' in cell && typeof cell.text === 'string') return cell.text.trim()
  if (typeof cell === 'object' && 'result' in cell) return cellToString((cell as { result: unknown }).result)
  return String(cell).trim()
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function mapCategory(raw: string): AssetCategory {
  const trimmed = raw.trim()
  if (!trimmed) return 'other'

  const labelKey = trimmed.toLowerCase()
  if (LABEL_TO_CATEGORY[labelKey]) return LABEL_TO_CATEGORY[labelKey]
  if (EXTRA_LABEL_ALIASES[labelKey]) return EXTRA_LABEL_ALIASES[labelKey]

  const withoutSubtotal = labelKey.replace(/\s+subtotal$/, '')
  if (LABEL_TO_CATEGORY[withoutSubtotal]) return LABEL_TO_CATEGORY[withoutSubtotal]
  if (EXTRA_LABEL_ALIASES[withoutSubtotal]) return EXTRA_LABEL_ALIASES[withoutSubtotal]

  return mapImportedAssetCategory(trimmed)
}

function mapOwnership(raw: string): Ownership {
  const v = raw.trim().toLowerCase()
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

function rowsToAssets(rows: string[][]): ParsedSpreadsheetAsset[] {
  if (rows.length === 0) return []

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

    const description = (record.description ?? '').trim()
    const value = parseNumber(record.value ?? '')
    const categoryRaw = record.category ?? ''

    if (!description && !value && !categoryRaw) continue

    const details: Record<string, string | number> = {}
    for (const key of [
      'property_type',
      'mortgage_balance',
      'institution',
      'account_type',
      'beneficiary',
      'insured',
      'from_whom',
      'timeline',
    ]) {
      const val = record[key]
      if (!val) continue
      details[key] = key === 'mortgage_balance' ? parseNumber(val) : val
    }

    assets.push({
      category: mapCategory(categoryRaw),
      description: description || categoryRaw || 'Imported asset',
      value,
      ownership: mapOwnership(record.ownership ?? 'client'),
      details,
    })
  }

  return assets
}

async function parseXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheet =
    workbook.getWorksheet('Assets') ??
    workbook.worksheets.find(ws => ws.rowCount > 0) ??
    workbook.worksheets[0]

  if (!sheet) return []

  const rows: string[][] = []
  sheet.eachRow(row => {
    const values = row.values
    if (!Array.isArray(values)) return
    rows.push(values.slice(1).map(cellToString))
  })
  return rows
}

export function isAssetSpreadsheetFile(name: string, mimeType = ''): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.csv') ||
    mimeType === XLSX_MIME ||
    mimeType === CSV_MIME
  )
}

export function getAssetSpreadsheetValidationError(
  file: Pick<File, 'name' | 'type' | 'size'> | null,
): string | null {
  if (!file) return 'No file provided'
  if (file.size > MAX_ASSET_SPREADSHEET_BYTES) return 'File is too large (10 MB max)'
  if (!isAssetSpreadsheetFile(file.name, file.type)) {
    return 'Only Excel .xlsx or .csv files are supported for spreadsheet import'
  }
  return null
}

export async function parseAssetSpreadsheet(file: File): Promise<ParsedSpreadsheetAsset[]> {
  const validationError = getAssetSpreadsheetValidationError(file)
  if (validationError) throw new Error(validationError)

  const buffer = await file.arrayBuffer()
  const name = file.name.toLowerCase()

  const rows = name.endsWith('.csv')
    ? parseCsvRows(new TextDecoder('utf-8').decode(buffer))
    : await parseXlsxRows(buffer)

  const assets = rowsToAssets(rows)
  if (assets.length === 0) {
    throw new Error('No asset rows found — check that headers include Category, Description, and Value')
  }
  return assets
}
