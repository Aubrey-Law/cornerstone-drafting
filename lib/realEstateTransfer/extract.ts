import path from 'node:path'
import {
  callAnthropic,
  PROMPT_INJECTION_GUARDRAIL,
  quoteUserContent,
} from '@/lib/anthropic'
import {
  coerceRealEstateTransferFields,
  MIN_EXTRACTED_TEXT_LENGTH,
  REAL_ESTATE_TRANSFER_FIELD_KEYS,
  type RealEstateTransferFields,
} from './fields'

const FIELD_LIST = REAL_ESTATE_TRANSFER_FIELD_KEYS.join(', ')

export const REAL_ESTATE_TRANSFER_EXTRACT_SYSTEM_PROMPT = `${PROMPT_INJECTION_GUARDRAIL}

You extract Massachusetts real-estate transfer data from an existing deed PDF (text or scanned).

Output ONLY one JSON object. Do not include markdown, explanation, comments, or additional text.

Use only these known fields:
${FIELD_LIST}

Never invent facts. If a value is unknown, omitted, unclear, or only implied, omit that field entirely.
Use ISO dates (YYYY-MM-DD) where possible.
Extract grantor from the deed as recorded.
Extract prior_deed_book, prior_deed_page, prior_deed_date, certificate_number, and registry_district from recording references when present.
registry_district is the Registry of Deeds district or Land Court reference.
For grantee on a trust transfer, include the trustee name(s) and trust name when present.
property_state should be the two-letter state abbreviation when known.`

function parseJsonFromModelText(raw: string): unknown {
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('AI did not return JSON')
  }
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
}

export async function extractDeedPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return typeof result.text === 'string' ? result.text : ''
  } finally {
    await parser.destroy()
  }
}

function substantiveText(text: string): boolean {
  return text.replace(/\s+/g, '').length >= MIN_EXTRACTED_TEXT_LENGTH
}

async function extractFromText(text: string): Promise<RealEstateTransferFields> {
  const response = await callAnthropic(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: REAL_ESTATE_TRANSFER_EXTRACT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          'Extract proposed real-estate transfer fields from the untrusted deed text below.',
          quoteUserContent('deed_text', text),
        ].join('\n\n'),
      }],
    },
    { route: 'drafting/real-estate-transfer' },
  )

  const raw = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()

  let parsed: unknown
  try {
    parsed = parseJsonFromModelText(raw)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('AI returned invalid JSON')
    throw error
  }

  return coerceRealEstateTransferFields(parsed)
}

async function extractFromPdfDocument(buffer: Buffer): Promise<RealEstateTransferFields> {
  const base64 = buffer.toString('base64')
  const response = await callAnthropic(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: REAL_ESTATE_TRANSFER_EXTRACT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: 'Extract proposed real-estate transfer fields from this deed PDF. Return only the JSON object.',
          },
        ],
      }],
    },
    { route: 'drafting/real-estate-transfer' },
  )

  const raw = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()

  let parsed: unknown
  try {
    parsed = parseJsonFromModelText(raw)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('AI returned invalid JSON')
    throw error
  }

  return coerceRealEstateTransferFields(parsed)
}

export async function extractRealEstateTransferFields(file: File): Promise<RealEstateTransferFields> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const text = (await extractDeedPdfText(buffer)).trim()

  const fields = substantiveText(text)
    ? await extractFromText(text)
    : await extractFromPdfDocument(buffer)

  if (Object.keys(fields).length === 0) {
    throw new Error('No real-estate transfer fields were found in the deed PDF')
  }

  return fields
}

export function getRealEstateTransferTemplatePath(templateFile: string): string {
  return path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates', templateFile)
}
