import { z } from 'zod'

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
  practiceArea: z.preprocess(blankToNull, z.string().transform(value => value.toUpperCase()).nullable()),
  source: optionalText,
  status: z.enum(['lead', 'hired', 'lost'], { message: 'Invalid lead status' }),
  fee: z.preprocess(blankToNull, z.number().finite('Invalid fee').nonnegative('Invalid fee').nullable()),
  urgency: z.preprocess(blankToNull, z.enum(['low', 'normal', 'high']).nullable()),
  estimatedEstateValue: optionalNumber,
  hasMinorChildren: z.preprocess(value => value ?? null, z.boolean().nullable()),
  qualificationNotes: optionalText,
  spouse: z.preprocess(value => value ?? null, spouseSchema.nullable()),
})

export type LeadDetailsInput = z.input<typeof leadDetailsSchema>
export type ValidatedLeadDetails = z.output<typeof leadDetailsSchema>

export function validateLeadDetails(input: LeadDetailsInput): ValidatedLeadDetails {
  return leadDetailsSchema.parse(input)
}
