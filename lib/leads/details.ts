import { z } from 'zod'
import { parsePracticeArea } from '@/lib/practiceArea'
import type { LeadSnapshotRow, LeadSpouseSnapshot } from '@/types/database'

const blankToNull = (value: unknown) => {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return value
}

const optionalText = z.preprocess(blankToNull, z.string().nullable())
const optionalEmail = z.preprocess(
  blankToNull,
  z.string().email('Invalid email').transform(value => value.toLowerCase()).nullable(),
)
const optionalDate = z.preprocess(blankToNull, z.string().date().nullable())
const optionalNumber = z.preprocess(
  blankToNull,
  z.number().finite('Invalid amount').nonnegative('Invalid amount').nullable(),
)
const optionalPracticeArea = z.preprocess(
  value => {
    const normalized = parsePracticeArea(blankToNull(value))
    return normalized ?? blankToNull(value)
  },
  z.enum(['EP', 'EP-LP', 'Probate'], { message: 'Invalid practice area' }).nullable(),
)

const spouseSchema = z.object({
  firstName: z.string().trim().min(1, 'Spouse first name is required'),
  middleName: optionalText,
  lastName: z.string().trim().min(1, 'Spouse last name is required'),
  preferredName: optionalText,
  email: optionalEmail,
  phone: optionalText,
  dateOfBirth: optionalDate,
})

const leadDetailsSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  middleName: optionalText,
  lastName: z.string().trim().min(1, 'Last name is required'),
  preferredName: optionalText,
  email: z.string().trim().email('Invalid email').transform(value => value.toLowerCase()),
  phone: optionalText,
  dateOfBirth: optionalDate,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  zip: optionalText,
  county: optionalText,
  maritalStatus: optionalText,
  practiceArea: optionalPracticeArea,
  source: optionalText,
  status: z.enum(['lead', 'hired', 'lost', 'declined'], { message: 'Invalid lead status' }),
  fee: z.preprocess(blankToNull, z.number().finite('Invalid fee').nonnegative('Invalid fee').nullable()),
  urgency: z.preprocess(blankToNull, z.enum(['low', 'normal', 'high']).nullable()),
  estimatedEstateValue: optionalNumber,
  hasMinorChildren: z.preprocess(value => value ?? null, z.boolean().nullable()),
  qualificationNotes: optionalText,
  spouse: z.preprocess(value => value ?? null, spouseSchema.nullable()),
})

export type LeadDetailsInput = z.input<typeof leadDetailsSchema>
export type ValidatedLeadDetails = z.output<typeof leadDetailsSchema>

export const leadEditableFields = [
  'firstName', 'middleName', 'lastName', 'preferredName',
  'email', 'phone', 'dateOfBirth', 'address',
  'maritalStatus', 'practiceArea', 'source', 'fee', 'urgency',
  'estimatedEstateValue', 'hasMinorChildren', 'qualificationNotes', 'spouse',
] as const
export type LeadEditableField = typeof leadEditableFields[number]
export type ValidatedLeadFieldPatch = {
  field: LeadEditableField
  value: unknown
}

const leadFieldPatchSchema = z.object({
  field: z.enum(leadEditableFields),
  value: z.unknown(),
}).strict().refine(
  patch => Object.prototype.hasOwnProperty.call(patch, 'value'),
  { path: ['value'], message: 'Value is required' },
)

const addressPatchSchema = z.object({
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  zip: optionalText,
  county: optionalText,
}).strict()

const spousePatchSchema = spouseSchema.strict().nullable()

const scalarFieldPatchSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('firstName'), value: z.string().trim().min(1, 'First name is required') }).strict(),
  z.object({ field: z.literal('middleName'), value: optionalText }).strict(),
  z.object({ field: z.literal('lastName'), value: z.string().trim().min(1, 'Last name is required') }).strict(),
  z.object({ field: z.literal('preferredName'), value: optionalText }).strict(),
  z.object({ field: z.literal('email'), value: z.string().trim().email('Invalid email').transform(value => value.toLowerCase()) }).strict(),
  z.object({ field: z.literal('phone'), value: optionalText }).strict(),
  z.object({ field: z.literal('dateOfBirth'), value: optionalDate }).strict(),
  z.object({ field: z.literal('maritalStatus'), value: optionalText }).strict(),
  z.object({ field: z.literal('practiceArea'), value: optionalPracticeArea }).strict(),
  z.object({ field: z.literal('source'), value: optionalText }).strict(),
  z.object({ field: z.literal('fee'), value: z.preprocess(blankToNull, z.number().finite('Invalid fee').nonnegative('Invalid fee').nullable()) }).strict(),
  z.object({ field: z.literal('urgency'), value: z.preprocess(blankToNull, z.enum(['low', 'normal', 'high']).nullable()) }).strict(),
  z.object({ field: z.literal('estimatedEstateValue'), value: optionalNumber }).strict(),
  z.object({ field: z.literal('hasMinorChildren'), value: z.preprocess(value => value ?? null, z.boolean().nullable()) }).strict(),
  z.object({ field: z.literal('qualificationNotes'), value: optionalText }).strict(),
])

function snapshotToLeadDetailsInput(
  lead: LeadSnapshotRow,
  spouse: LeadSpouseSnapshot | null,
): LeadDetailsInput {
  return {
    firstName: lead.first_name ?? '',
    middleName: lead.middle_name,
    lastName: lead.last_name ?? '',
    preferredName: lead.preferred_name,
    email: lead.email ?? '',
    phone: lead.phone,
    dateOfBirth: lead.date_of_birth,
    addressLine1: lead.address_line1,
    addressLine2: lead.address_line2,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    county: lead.county,
    maritalStatus: lead.marital_status,
    practiceArea: lead.practice_area,
    source: lead.lead_source,
    status: lead.lead_status,
    fee: lead.engagement_fee_quoted,
    urgency: lead.lead_urgency,
    estimatedEstateValue: lead.taxable_estate,
    hasMinorChildren: lead.has_minor_children,
    qualificationNotes: lead.qualification_notes,
    spouse: spouse ? {
      firstName: spouse.first_name,
      middleName: spouse.middle_name,
      lastName: spouse.last_name,
      preferredName: spouse.preferred_name,
      email: spouse.email,
      phone: spouse.phone,
      dateOfBirth: spouse.date_of_birth,
    } : null,
  }
}

function completeAddress(complete: LeadDetailsInput, value: unknown) {
  const address = addressPatchSchema.parse(value)
  complete.addressLine1 = address.addressLine1
  complete.addressLine2 = address.addressLine2
  complete.city = address.city
  complete.state = address.state
  complete.zip = address.zip
  complete.county = address.county
}

function parseSpouseValue(value: unknown) {
  return spousePatchSchema.parse(value)
}

function assignScalarField(
  complete: LeadDetailsInput,
  patch: { field: LeadEditableField; value?: unknown },
) {
  const parsed = scalarFieldPatchSchema.parse(patch)
  switch (parsed.field) {
    case 'firstName': complete.firstName = parsed.value; break
    case 'middleName': complete.middleName = parsed.value; break
    case 'lastName': complete.lastName = parsed.value; break
    case 'preferredName': complete.preferredName = parsed.value; break
    case 'email': complete.email = parsed.value; break
    case 'phone': complete.phone = parsed.value; break
    case 'dateOfBirth': complete.dateOfBirth = parsed.value; break
    case 'maritalStatus': complete.maritalStatus = parsed.value; break
    case 'practiceArea': complete.practiceArea = parsed.value; break
    case 'source': complete.source = parsed.value; break
    case 'fee': complete.fee = parsed.value; break
    case 'urgency': complete.urgency = parsed.value; break
    case 'estimatedEstateValue': complete.estimatedEstateValue = parsed.value; break
    case 'hasMinorChildren': complete.hasMinorChildren = parsed.value; break
    case 'qualificationNotes': complete.qualificationNotes = parsed.value; break
  }
}

export function validateLeadDetails(input: LeadDetailsInput): ValidatedLeadDetails {
  return leadDetailsSchema.parse(input)
}

export function validateLeadFieldPatch(input: unknown): ValidatedLeadFieldPatch {
  const patch = leadFieldPatchSchema.parse(input)
  if (patch.field === 'address') {
    return { field: patch.field, value: addressPatchSchema.parse(patch.value) }
  }
  if (patch.field === 'spouse') {
    return { field: patch.field, value: spousePatchSchema.parse(patch.value) }
  }
  const scalar = scalarFieldPatchSchema.parse(patch)
  return { field: scalar.field, value: scalar.value }
}

export function mergeLeadFieldPatch(
  lead: LeadSnapshotRow,
  spouse: LeadSpouseSnapshot | null,
  patch: { field: LeadEditableField; value: unknown },
): ValidatedLeadDetails {
  const parsedPatch = validateLeadFieldPatch(patch)
  const complete = snapshotToLeadDetailsInput(lead, spouse)
  if (parsedPatch.field === 'address') completeAddress(complete, parsedPatch.value)
  else if (parsedPatch.field === 'spouse') complete.spouse = parseSpouseValue(parsedPatch.value)
  else assignScalarField(complete, parsedPatch)
  return validateLeadDetails(complete)
}
