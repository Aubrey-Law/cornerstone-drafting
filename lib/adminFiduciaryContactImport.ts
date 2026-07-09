import Anthropic from '@anthropic-ai/sdk'
import ExcelJS from 'exceljs'
import { callAnthropic, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { parseLeadFiduciaryContactImport, type ImportedLeadFiduciaryContact } from '@/lib/leadFiduciaryImport'
import { formatPhoneInput } from '@/lib/phone'

export const MIN_FIDUCIARY_IMPORT_TEXT_LENGTH = 10
export const MAX_FIDUCIARY_IMPORT_TEXT_LENGTH = 60_000
export const MAX_FIDUCIARY_IMPORT_FILE_BYTES = 10 * 1024 * 1024

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function getFiduciaryImportTextValidationError(text: string): string | null {
  if (!text.trim()) return 'text required'
  if (text.trim().length < MIN_FIDUCIARY_IMPORT_TEXT_LENGTH) return 'text too short (10 char min)'
  if (text.length > MAX_FIDUCIARY_IMPORT_TEXT_LENGTH) return 'text too long (60k char max)'
  return null
}

export function getFiduciaryImportFileValidationError(file: File | null): string | null {
  if (!file) return 'No file provided'
  if (file.size > MAX_FIDUCIARY_IMPORT_FILE_BYTES) return 'Document is too large (10 MB max)'

  const name = file.name.toLowerCase()
  const ok =
    name.endsWith('.docx') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.csv') ||
    name.endsWith('.txt') ||
    file.type === DOCX_MIME_TYPE ||
    file.type === XLSX_MIME_TYPE ||
    file.type === 'text/csv' ||
    file.type === 'text/plain'

  return ok ? null : 'Only Word .docx, Excel .xlsx, CSV, and text files are supported'
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function coerceImportedContacts(input: unknown): ImportedLeadFiduciaryContact[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      name: clean(item.name),
      relationship: clean(item.relationship),
      address: clean(item.address),
      email: clean(item.email),
      phone: formatPhoneInput(clean(item.phone)),
    }))
    .filter(contact => contact.name || contact.email || contact.phone)
}

function parseJsonFromModelText(raw: string): unknown {
  const jsonStart = raw.indexOf('[')
  const jsonEnd = raw.lastIndexOf(']')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('AI did not return JSON')
  }
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
}

function isAnthropicAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number; statusCode?: number }).status
    ?? (error as { status?: number; statusCode?: number }).statusCode
  if (status === 401) return true
  const message = error instanceof Error ? error.message : String(error)
  return /invalid x-api-key|authentication_error|api key/i.test(message)
}

async function extractContactsWithAi(text: string, userId: string | null): Promise<ImportedLeadFiduciaryContact[]> {
  const message = await callAnthropic(
    {
      model: await resolveFirmModel('light'),
      max_tokens: 1800,
      system: `${PROMPT_INJECTION_GUARDRAIL}

Extract fiduciary/contact information for a Massachusetts estate planning matter.
Return ONLY a JSON array. Do not include markdown or commentary.

Each array item must have:
{
  "name": string,
  "relationship": string,
  "address": string,
  "email": string,
  "phone": string
}

Use empty strings for unknown fields. Do not invent values. Include people who appear to be fiduciaries, agents, trustees, executors/personal representatives, guardians, health care proxies, powers of attorney, beneficiaries, family contacts, or other relevant estate-planning contacts.`,
      messages: [{
        role: 'user',
        content: quoteUserContent('contact_import_text', text.slice(0, MAX_FIDUCIARY_IMPORT_TEXT_LENGTH)),
      }],
    },
    { route: 'admin/contacts/import', contextType: 'general', userId },
  )

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()

  return coerceImportedContacts(parseJsonFromModelText(raw))
}

export async function parseFiduciaryContactsFromText(args: {
  text: string
  userId?: string | null
  preferAi?: boolean
}): Promise<ImportedLeadFiduciaryContact[]> {
  const text = args.text.trim()
  const validationError = getFiduciaryImportTextValidationError(text)
  if (validationError) throw new Error(validationError)

  const deterministic = parseLeadFiduciaryContactImport(text)
  if (deterministic.length > 0) return deterministic
  if (!args.preferAi) return []

  try {
    const aiContacts = await extractContactsWithAi(text, args.userId ?? null)
    if (aiContacts.length > 0) return aiContacts
  } catch (error) {
    if (isAnthropicAuthenticationError(error)) {
      throw new Error(
        'AI contact import is unavailable because ANTHROPIC_API_KEY is invalid. Structured CSV/text imports can still work without AI.',
      )
    }
    throw error
  }

  return []
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function extractXlsxText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const rows: string[] = []

  for (const worksheet of workbook.worksheets) {
    rows.push(`Sheet: ${worksheet.name}`)
    worksheet.eachRow((row) => {
      const values = row.values
      if (!Array.isArray(values)) return
      const cells = values
        .slice(1)
        .map((cell) => {
          if (cell == null) return ''
          if (typeof cell === 'object' && 'text' in cell && typeof cell.text === 'string') return cell.text
          return String(cell)
        })
      if (cells.some(cell => cell.trim())) rows.push(cells.join(','))
    })
  }

  return rows.join('\n')
}

export async function extractFiduciaryImportFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx') || file.type === DOCX_MIME_TYPE) return extractDocxText(file)
  if (name.endsWith('.xlsx') || file.type === XLSX_MIME_TYPE) return extractXlsxText(file)
  return file.text()
}
