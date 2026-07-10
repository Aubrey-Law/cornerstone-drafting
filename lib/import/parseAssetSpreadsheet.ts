import ExcelJS from 'exceljs'
import { parseCsvRows } from '@/lib/import/parseCsvRows'
import {
  cellToString,
  parseAssetSpreadsheetRows,
  type ParsedSpreadsheetAsset,
} from '@/lib/import/parseAssetSpreadsheetRows'

export const MAX_ASSET_SPREADSHEET_BYTES = 10 * 1024 * 1024

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CSV_MIME = 'text/csv'

export type { ParsedSpreadsheetAsset }
export { parseAssetSpreadsheetRows }

async function parseXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheet =
    workbook.getWorksheet('Financial Summary') ??
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

  const assets = parseAssetSpreadsheetRows(rows)
  if (assets.length === 0) {
    throw new Error('No asset rows found — check that headers include Category, Description, and Value')
  }
  return assets
}
