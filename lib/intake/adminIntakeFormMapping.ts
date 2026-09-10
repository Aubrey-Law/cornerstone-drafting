import { formatPhoneInput } from '@/lib/phone'
import { parsePlanningObjectives, PLANNING_OBJECTIVES_NOTES_KEY } from '@/lib/intakePlanningObjectives'
import { normalizeCitizenshipStatus } from '@/lib/sharedFields'
import {
  adminFiduciaryFlatFromRoles,
  probateFlatFromDetails,
  type AdminFiduciaryRoleRow,
} from '@/lib/adminIntakeFiduciaries'
import type { AdminIntakeChild, AdminIntakeFormData } from '@/types/adminIntake'

function uid() {
  return Math.random().toString(36).slice(2)
}

/**
 * Flatten a hydrated `client_intake` row into the attorney intake form's shape.
 *
 * Shared by the intake sheet (which edits these values) and the Word export
 * (which prints them), so an exported form always reads back what the sheet
 * shows.
 */
export function mapRawIntakeToFormData(raw: Record<string, unknown>): AdminIntakeFormData {
  const str = (key: string): string => {
    const v = raw[key]
    return typeof v === 'string' ? v : ''
  }
  const bool = (key: string): boolean => Boolean(raw[key])

  const spouseData = (raw['_spouse'] as Record<string, unknown> | undefined) ?? {}

  const children = ((): AdminIntakeChild[] => {
    const v = raw['_children']
    if (!Array.isArray(v)) return []
    return v.map((c: Record<string, unknown>, i: number) => ({
      id: typeof c.contact_id === 'string' && c.contact_id ? c.contact_id : uid(),
      first_name: typeof c.first_name === 'string' ? c.first_name : (c.name as string ?? `Child ${i + 1}`),
      middle_name: typeof c.middle_name === 'string' ? c.middle_name : '',
      last_name: typeof c.last_name === 'string' ? c.last_name : '',
      date_of_birth: typeof c.date_of_birth === 'string' ? c.date_of_birth : (typeof c.dob === 'string' ? c.dob : ''),
      // The hydrated child entry exposes the contacts column as `pronouns`.
      preferred_pronoun:
        typeof c.preferred_pronoun === 'string'
          ? c.preferred_pronoun
          : (typeof c.pronouns === 'string' ? c.pronouns : ''),
    }))
  })()

  const financial = (raw['financial_details'] as Record<string, unknown> | null) ?? {}
  const familyDetails = (raw['family_details'] as Record<string, unknown> | null) ?? {}

  // Fiduciaries live in contact_roles (attached as _fiduciary_roles by
  // getAdminIntakeData); probate fields live in the probate_details jsonb.
  const fid = adminFiduciaryFlatFromRoles(
    Array.isArray(raw['_fiduciary_roles']) ? (raw['_fiduciary_roles'] as AdminFiduciaryRoleRow[]) : [],
  )
  const probate = probateFlatFromDetails(raw['probate_details'])

  return {
    first_name: str('first_name'),
    middle_name: str('middle_name'),
    last_name: str('last_name'),
    suffix: str('suffix'),
    date_of_birth: str('date_of_birth'),
    is_us_citizen: bool('is_us_citizen'),
    citizenship_status: normalizeCitizenshipStatus(raw['citizenship_status'], bool('is_us_citizen')),
    preferred_pronoun: str('preferred_pronoun'),
    phone: formatPhoneInput(str('phone')),
    email: str('email'),
    address_line1: str('address_line1'),
    address_line2: str('address_line2'),
    city: str('city'),
    state: str('state') || 'MA',
    zip: str('zip'),
    county: str('county'),
    marital_status: str('marital_status'),
    has_children: bool('has_children'),
    has_minor_children: bool('has_minor_children'),
    children,
    family_notes: typeof familyDetails.notes === 'string' ? familyDetails.notes : '',
    spouse_first_name: typeof spouseData.first_name === 'string' ? spouseData.first_name : str('spouse_first_name'),
    spouse_middle_name: typeof spouseData.middle_name === 'string' ? spouseData.middle_name : str('spouse_middle_name'),
    spouse_last_name: typeof spouseData.last_name === 'string' ? spouseData.last_name : str('spouse_last_name'),
    spouse_date_of_birth: typeof spouseData.date_of_birth === 'string' ? spouseData.date_of_birth : str('spouse_date_of_birth'),
    spouse_is_us_citizen: typeof spouseData.is_us_citizen === 'boolean' ? spouseData.is_us_citizen : null,
    spouse_citizenship_status: normalizeCitizenshipStatus(
      spouseData.citizenship_status,
      typeof spouseData.is_us_citizen === 'boolean' ? spouseData.is_us_citizen : null,
    ),
    spouse_preferred_pronoun:
      typeof spouseData.preferred_pronoun === 'string' ? spouseData.preferred_pronoun : '',
    spouse_phone: formatPhoneInput(typeof spouseData.phone === 'string' ? spouseData.phone : str('spouse_phone')),
    spouse_email: typeof spouseData.email === 'string' ? spouseData.email : str('spouse_email'),
    date_of_marriage: str('date_of_marriage'),
    estate_value: str('estate_value'),
    has_real_property: bool('has_real_property'),
    real_property_address: typeof financial.real_property_address === 'string' ? financial.real_property_address : '',
    real_property_value: typeof financial.real_property_value === 'string' ? financial.real_property_value : '',
    has_retirement: bool('has_retirement'),
    retirement_value: typeof financial.retirement_value === 'string' ? financial.retirement_value : '',
    has_life_insurance: bool('has_life_insurance'),
    life_insurance_value: typeof financial.life_insurance_value === 'string' ? financial.life_insurance_value : '',
    has_business: bool('has_business'),
    business_description: typeof financial.business_description === 'string' ? financial.business_description : '',
    has_investments: bool('has_investments'),
    // Portal answers live in the object shape; the admin textarea edits only
    // the free-text `notes` key so a save never stomps the client's answers.
    planning_objectives: parsePlanningObjectives(raw['planning_objectives'])?.[PLANNING_OBJECTIVES_NOTES_KEY] ?? '',
    has_existing_plan: bool('has_existing_plan'),
    has_will: bool('has_will'),
    has_trust: bool('has_trust'),
    has_poa: bool('has_poa'),
    has_hcp: bool('has_hcp'),
    special_circumstances: Array.isArray(raw['special_circumstances'])
      ? (raw['special_circumstances'] as unknown[]).filter((value): value is string => typeof value === 'string')
      : [],
    trustee_primary: fid.trustee_primary ?? '',
    trustee_primary_pronouns: fid.trustee_primary_pronouns ?? '',
    trustee_alternate: fid.trustee_alternate ?? '',
    trustee_alternate_pronouns: fid.trustee_alternate_pronouns ?? '',
    executor_primary: fid.executor_primary ?? '',
    executor_primary_pronouns: fid.executor_primary_pronouns ?? '',
    executor_alternate: fid.executor_alternate ?? '',
    executor_alternate_pronouns: fid.executor_alternate_pronouns ?? '',
    poa_primary: fid.poa_primary ?? '',
    poa_primary_pronouns: fid.poa_primary_pronouns ?? '',
    poa_alternate: fid.poa_alternate ?? '',
    poa_alternate_pronouns: fid.poa_alternate_pronouns ?? '',
    hcp_primary: fid.hcp_primary ?? '',
    hcp_primary_pronouns: fid.hcp_primary_pronouns ?? '',
    hcp_alternate: fid.hcp_alternate ?? '',
    hcp_alternate_pronouns: fid.hcp_alternate_pronouns ?? '',
    guardian_primary: fid.guardian_primary ?? '',
    guardian_primary_pronouns: fid.guardian_primary_pronouns ?? '',
    guardian_alternate: fid.guardian_alternate ?? '',
    guardian_alternate_pronouns: fid.guardian_alternate_pronouns ?? '',
    pb_decedent_name: probate.pb_decedent_name ?? '',
    pb_date_of_death: probate.pb_date_of_death ?? '',
    pb_domicile: probate.pb_domicile ?? '',
    pb_estate_value: probate.pb_estate_value ?? '',
    pb_known_assets: probate.pb_known_assets ?? '',
    pb_known_debts: probate.pb_known_debts ?? '',
    pb_petitioner_relationship: probate.pb_petitioner_relationship ?? '',
    pb_goals_timeline: probate.pb_goals_timeline ?? '',
    special_notes: str('special_notes'),
  }
}
