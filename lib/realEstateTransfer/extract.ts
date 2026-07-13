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

Use only these known scalar fields, plus boundary_calls as described below:
${FIELD_LIST}

Never invent facts. If a value is unknown, omitted, unclear, or only implied, omit that field entirely.
Use ISO dates (YYYY-MM-DD) where possible.
The uploaded document is the current deed, and the output will be used to prepare a new transfer deed.
Set grantor to the first current vested owner's full legal name and grantor_2 to the second current vested owner's full legal name, as shown as grantee(s) on the uploaded current deed. Use ALL CAPS. If there is only one current owner, omit grantor_2. Do not copy the uploaded deed's historical grantor into either field.
Omit grantee. The proposed new grantee is selected separately by the attorney in the drafting form.
Extract property_address, property_city, property_state, property_county, parcel_id, and grantee_mailing_address. The grantee mailing address is usually the property address, but use the deed's stated grantee mailing address when one is printed.
Set property_description to the opening description paragraph. Preserve deed language faithfully; do not summarize, modernize, or silently correct it.
For a metes-and-bounds description, set description_type to "metes_and_bounds" and output boundary_calls as an array of objects in deed order. Every object must have exactly directional_call and bound_description strings. Preserve every call; the array is not limited to six entries.
Set description_2 to the second description paragraph, including easement or appurtenance language, when present. Omit it when there is no second paragraph.
For a lot/plan description, set description_type to "lot_plan", place the complete legal description in property_description, and omit boundary_calls.
Set recording_system to "registry" for recorded land or "land_court" for registered land.
Set recording_date, registry_of_deeds, current_deed_book_number, and current_deed_page from the recording information for the uploaded deed itself when it is Registry-recorded land. registry_of_deeds must be the full printed registry name.
For registered land, set recording_date, registry_of_deeds, current_deed_document_number, and current_certificate_number from the uploaded deed's Land Court recording information.
Do not use an older deed citation contained in the uploaded deed's title recital as the uploaded current deed's recording information.
The legacy fields legal_description, prior_deed_book, prior_deed_page, prior_deed_date, registry_district, and certificate_number are accepted for stored-data compatibility but should not be returned for a new extraction.
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
