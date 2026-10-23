import { z } from 'zod'

export const REAL_ESTATE_TRANSFER_FIELD_KEYS = [
  'grantor',
  'grantor_2',
  'grantee',
  'trustees',
  'settlor',
  'trust_name',
  'trust_date',
  'beneficial_owners',
  'property_address',
  'property_city',
  'property_state',
  'property_county',
  'legal_description',
  'property_description',
  'description_2',
  'description_type',
  'recording_system',
  'recording_date',
  'registry_of_deeds',
  'current_deed_book_number',
  'current_deed_page',
  'current_deed_document_number',
  'current_certificate_number',
  'grantee_mailing_address',
  'prior_deed_book',
  'prior_deed_page',
  'prior_deed_date',
  'registry_district',
  'parcel_id',
  'certificate_number',
  'consideration',
  'execution_date',
  'certificate_execution_county',
  'trust_term_extension_years',
] as const

export type RealEstateTransferFieldKey = (typeof REAL_ESTATE_TRANSFER_FIELD_KEYS)[number]

export type FieldSection = 'trust' | 'deed' | 'certificate'

export interface RealEstateTransferFieldMeta {
  key: RealEstateTransferFieldKey
  label: string
  section: FieldSection
  multiline?: boolean
  fromDeed?: boolean
}

export const REAL_ESTATE_TRANSFER_FIELDS: RealEstateTransferFieldMeta[] = [
  { key: 'grantor', label: 'First grantor', section: 'deed', fromDeed: true },
  { key: 'grantor_2', label: 'Second grantor (if any)', section: 'deed', fromDeed: true },
  { key: 'grantee', label: 'Grantee(s)', section: 'deed' },
  { key: 'property_address', label: 'Property street address', section: 'deed' },
  { key: 'property_city', label: 'City / town', section: 'deed' },
  { key: 'property_state', label: 'State', section: 'deed' },
  { key: 'property_county', label: 'County', section: 'deed' },
  { key: 'legal_description', label: 'Legal description', section: 'deed', multiline: true, fromDeed: true },
  { key: 'property_description', label: 'Opening property description', section: 'deed', multiline: true, fromDeed: true },
  { key: 'description_2', label: 'Additional description / easements', section: 'deed', multiline: true, fromDeed: true },
  { key: 'description_type', label: 'Description type (metes_and_bounds or lot_plan)', section: 'deed', fromDeed: true },
  { key: 'recording_system', label: 'Recording system (registry or land_court)', section: 'deed', fromDeed: true },
  { key: 'recording_date', label: 'Current deed recording date', section: 'deed', fromDeed: true },
  { key: 'registry_of_deeds', label: 'Full Registry of Deeds / Land Court name', section: 'deed', fromDeed: true },
  { key: 'current_deed_book_number', label: 'Current deed book number', section: 'deed', fromDeed: true },
  { key: 'current_deed_page', label: 'Current deed page', section: 'deed', fromDeed: true },
  { key: 'current_deed_document_number', label: 'Current deed document number', section: 'deed', fromDeed: true },
  { key: 'current_certificate_number', label: 'Current certificate of title number', section: 'deed', fromDeed: true },
  { key: 'grantee_mailing_address', label: 'Grantee mailing address', section: 'deed', fromDeed: true },
  { key: 'prior_deed_book', label: 'Prior deed book', section: 'deed', fromDeed: true },
  { key: 'prior_deed_page', label: 'Prior deed page', section: 'deed', fromDeed: true },
  { key: 'prior_deed_date', label: 'Prior deed date', section: 'deed', fromDeed: true },
  { key: 'parcel_id', label: 'Parcel / map-lot ID', section: 'deed' },
  { key: 'certificate_number', label: 'Certificate number', section: 'deed', fromDeed: true },
  { key: 'registry_district', label: 'Registry of deeds / land court', section: 'deed', fromDeed: true },
  { key: 'consideration', label: 'Consideration', section: 'deed' },
  { key: 'execution_date', label: 'Execution date', section: 'deed' },
  { key: 'trust_name', label: 'Realty trust name', section: 'trust' },
  { key: 'trust_date', label: 'Realty trust date', section: 'trust' },
  { key: 'trustees', label: 'Trustee(s)', section: 'trust' },
  { key: 'settlor', label: 'Settlor', section: 'trust' },
  { key: 'beneficial_owners', label: 'Beneficial owners', section: 'trust', multiline: true },
  { key: 'certificate_execution_county', label: 'Certificate execution county', section: 'certificate' },
  { key: 'trust_term_extension_years', label: 'Successive trust term (years)', section: 'trust' },
]

export const DEED_EXTRACTED_FIELD_KEYS = REAL_ESTATE_TRANSFER_FIELDS
  .filter(field => field.fromDeed)
  .map(field => field.key)

const fieldShape = Object.fromEntries(
  REAL_ESTATE_TRANSFER_FIELD_KEYS.map(key => [key, z.string().optional()]),
) as Record<RealEstateTransferFieldKey, z.ZodOptional<z.ZodString>>

export const BoundaryCallSchema = z.object({
  directional_call: z.string(),
  bound_description: z.string(),
})

export type BoundaryCall = z.infer<typeof BoundaryCallSchema>

export const RealEstateTransferFieldsSchema = z.object({
  ...fieldShape,
  boundary_calls: z.array(BoundaryCallSchema).optional(),
})

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
    label: 'Deed (Registry or Land Court)',
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

function coerceBoundaryCalls(value: unknown): BoundaryCall[] | undefined {
  if (!Array.isArray(value)) return undefined
  const calls = value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const directional_call = coerceString(source.directional_call)
    const bound_description = coerceString(source.bound_description)
    return directional_call && bound_description ? [{ directional_call, bound_description }] : []
  })
  return calls.length > 0 ? calls : undefined
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
  const boundaryCalls = coerceBoundaryCalls(source.boundary_calls)
  if (boundaryCalls) result.boundary_calls = boundaryCalls
  return RealEstateTransferFieldsSchema.parse(result)
}

export function fieldsToTemplateData(fields: RealEstateTransferFields): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const key of REAL_ESTATE_TRANSFER_FIELD_KEYS) {
    data[key] = fields[key] ?? ''
  }
  const grantor = (fields.grantor ?? '').trim().toUpperCase()
  const grantor2 = (fields.grantor_2 ?? '').trim().toUpperCase()
  const grantors = [grantor, grantor2].filter(Boolean).map(name => ({ name }))
  const propertyAddress = [fields.property_address, fields.property_city, fields.property_state]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(', ')
  const plural = grantors.length > 1
  data.grantor = grantor
  data.grantor_2 = grantor2
  data.grantors = grantors
  data.grantor_display = [grantor, grantor2].filter(Boolean).join(' and ')
  data.grantor_defined_term = plural ? 'Grantors' : 'Grantor'
  data.grantor_possessive = plural ? 'Grantors\u2019' : 'Grantor\u2019s'
  data.grantor_person_phrase = plural ? 'the persons whose names are' : 'the person whose name is'
  data.grantor_pronoun = plural ? 'they' : 'that person'
  data.witness_phrase = plural ? 'our hands and seals' : 'my hand and seal'
  data.trust_name_upper = (fields.trust_name ?? '').trim().toUpperCase()
  data.trustee_title = /(?:\band\b|;|\n)/i.test(fields.trustees ?? '') ? 'Trustees' : 'Trustee'
  data.property_description = fields.property_description ?? fields.legal_description ?? ''
  data.description_2 = fields.description_2 ?? ''
  data.boundary_calls = fields.description_type === 'lot_plan'
    ? []
    : (fields.boundary_calls ?? []).filter(call => call.directional_call.trim() && call.bound_description.trim())
  data.recording_date = fields.recording_date ?? fields.prior_deed_date ?? ''
  data.registry_of_deeds = fields.registry_of_deeds ?? fields.registry_district ?? ''
  data.current_deed_book_number = fields.current_deed_book_number ?? fields.prior_deed_book ?? ''
  data.current_deed_page = fields.current_deed_page ?? fields.prior_deed_page ?? ''
  data.current_deed_document_number = fields.current_deed_document_number ?? ''
  data.current_certificate_number = fields.current_certificate_number ?? fields.certificate_number ?? ''
  // Same Registry / Land Court decision as the deed, for the certificate's recording line.
  data.is_land_court = deedTemplateVariant(fields) === DEED_TEMPLATE_VARIANTS.land_court
  data.grantee_mailing_address = fields.grantee_mailing_address ?? propertyAddress
  data.property_address_line = propertyAddress
  data.document_date_blank = '________________________'
  data.signing_county = fields.certificate_execution_county ?? fields.property_county ?? ''
  data.notary_commission_blank = '________________________'
  return data
}

export const DEED_TEMPLATE_VARIANTS = {
  registry: {
    id: 'real-estate-deed',
    label: 'Deed — Registry',
    templateFile: 'deed.docx',
    downloadBaseName: 'Deed-Registry',
  },
  land_court: {
    id: 'real-estate-deed-land-court',
    label: 'Deed — Land Court',
    templateFile: 'deed-landcourt.docx',
    downloadBaseName: 'Deed-Land-Court',
  },
} as const

export function deedTemplateVariant(fields: RealEstateTransferFields) {
  return fields.recording_system === 'land_court'
    || Boolean(fields.current_deed_document_number?.trim())
    ? DEED_TEMPLATE_VARIANTS.land_court
    : DEED_TEMPLATE_VARIANTS.registry
}

export const FIELD_SECTION_LABELS: Record<FieldSection, string> = {
  trust: 'Realty trust',
  deed: 'Deed',
  certificate: "Trustee's certificate",
}
