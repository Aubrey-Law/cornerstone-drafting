import { z } from 'zod'

export const REAL_ESTATE_TRANSFER_FIELD_KEYS = [
  'grantor',
  'grantee',
  'trustees',
  'settlor',
  'trust_name',
  'trust_date',
  'property_address',
  'property_city',
  'property_state',
  'property_county',
  'legal_description',
  'prior_deed_book',
  'prior_deed_page',
  'registry_district',
  'parcel_id',
  'consideration',
  'execution_date',
  'certificate_execution_county',
] as const

export type RealEstateTransferFieldKey = (typeof REAL_ESTATE_TRANSFER_FIELD_KEYS)[number]

export type FieldSection = 'shared' | 'deed' | 'certificate' | 'trust'

export interface RealEstateTransferFieldMeta {
  key: RealEstateTransferFieldKey
  label: string
  section: FieldSection
  multiline?: boolean
}

export const REAL_ESTATE_TRANSFER_FIELDS: RealEstateTransferFieldMeta[] = [
  { key: 'grantor', label: 'Grantor(s)', section: 'shared' },
  { key: 'grantee', label: 'Grantee(s)', section: 'shared' },
  { key: 'trustees', label: 'Trustee(s)', section: 'shared' },
  { key: 'settlor', label: 'Settlor', section: 'shared' },
  { key: 'trust_name', label: 'Trust name', section: 'shared' },
  { key: 'trust_date', label: 'Trust date', section: 'shared' },
  { key: 'property_address', label: 'Property street address', section: 'shared' },
  { key: 'property_city', label: 'City / town', section: 'shared' },
  { key: 'property_state', label: 'State', section: 'shared' },
  { key: 'property_county', label: 'County', section: 'shared' },
  { key: 'legal_description', label: 'Legal description', section: 'shared', multiline: true },
  { key: 'prior_deed_book', label: 'Prior deed book', section: 'shared' },
  { key: 'prior_deed_page', label: 'Prior deed page', section: 'shared' },
  { key: 'registry_district', label: 'Registry of deeds district', section: 'shared' },
  { key: 'parcel_id', label: 'Parcel / map-lot ID', section: 'shared' },
  { key: 'consideration', label: 'Consideration', section: 'deed' },
  { key: 'execution_date', label: 'Execution date', section: 'shared' },
  { key: 'certificate_execution_county', label: 'Certificate execution county', section: 'certificate' },
]

const fieldShape = Object.fromEntries(
  REAL_ESTATE_TRANSFER_FIELD_KEYS.map(key => [key, z.string().optional()]),
) as Record<RealEstateTransferFieldKey, z.ZodOptional<z.ZodString>>

export const RealEstateTransferFieldsSchema = z.object(fieldShape)

export type RealEstateTransferFields = z.infer<typeof RealEstateTransferFieldsSchema>

export type RealEstateTransferDocType = 'deed' | 'trustees_certificate' | 'real_estate_trust'

export const REAL_ESTATE_TRANSFER_DOC_TYPES = [
  'deed',
  'trustees_certificate',
  'real_estate_trust',
] as const satisfies readonly RealEstateTransferDocType[]

export const DOCUMENT_TYPES: Record<
  RealEstateTransferDocType,
  { label: string; templateFile: string; downloadBaseName: string }
> = {
  deed: {
    label: 'Deed',
    templateFile: 'deed.docx',
    downloadBaseName: 'Deed',
  },
  trustees_certificate: {
    label: "Trustee's Certificate",
    templateFile: 'trustees-certificate.docx',
    downloadBaseName: 'Trustees-Certificate',
  },
  real_estate_trust: {
    label: 'Real Estate Trust',
    templateFile: 'real-estate-trust.docx',
    downloadBaseName: 'Real-Estate-Trust',
  },
}

export const RealEstateTransferGenerateRequestSchema = z.object({
  fields: RealEstateTransferFieldsSchema,
  documents: z
    .array(z.enum(REAL_ESTATE_TRANSFER_DOC_TYPES))
    .min(1, 'Select at least one document'),
})

export const MAX_DEED_PDF_BYTES = 50 * 1024 * 1024
export const PDF_MIME_TYPE = 'application/pdf'
export const MIN_EXTRACTED_TEXT_LENGTH = 200

function coerceString(value: unknown): string | undefined {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

export function emptyRealEstateTransferFields(): RealEstateTransferFields {
  return {}
}

export function coerceRealEstateTransferFields(raw: unknown): RealEstateTransferFields {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const result: RealEstateTransferFields = {}
  for (const key of REAL_ESTATE_TRANSFER_FIELD_KEYS) {
    const value = coerceString(source[key])
    if (value !== undefined) result[key] = value
  }
  return RealEstateTransferFieldsSchema.parse(result)
}

export function fieldsToTemplateData(fields: RealEstateTransferFields): Record<string, string> {
  const data: Record<string, string> = {}
  for (const key of REAL_ESTATE_TRANSFER_FIELD_KEYS) {
    data[key] = fields[key] ?? ''
  }
  return data
}

export const FIELD_SECTION_LABELS: Record<FieldSection, string> = {
  shared: 'Property & parties',
  deed: 'Deed',
  certificate: "Trustee's certificate",
  trust: 'Real estate trust',
}
