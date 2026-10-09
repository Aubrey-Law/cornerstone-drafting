import { collegePrepFieldKey } from '@/lib/collegePrepFields'
import { isFinancialDetailsRootKey } from '@/lib/intakeFinancialFields'
import { parsePlanningObjectives } from '@/lib/intakePlanningObjectives'
import { unpackReferralDetailsFromFamilyDetails } from '@/lib/intakeReferralDetails'
import { formatPhoneInput } from '@/lib/phone'

export function unpackInitialIntakeData(
  initialData: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...initialData }

  const financialDetails = base.financial_details as Record<string, unknown> | undefined
  if (financialDetails && typeof financialDetails === 'object') {
    for (const [key, value] of Object.entries(financialDetails)) {
      if (isFinancialDetailsRootKey(key)) base[key] = value
      else base[`financial_${key}`] = value
    }
    delete base.financial_details
    const legacyAssets = base.financial_asset_types
    if (!base.asset_types && Array.isArray(legacyAssets)) base.asset_types = legacyAssets
  }

  const collegePrepDetails = base.college_prep_details as Record<string, unknown> | undefined
  if (collegePrepDetails && typeof collegePrepDetails === 'object') {
    for (const [key, value] of Object.entries(collegePrepDetails)) {
      base[collegePrepFieldKey(key)] = value
    }
    delete base.college_prep_details
  }

  if (base.review_choices && typeof base.review_choices === 'object') {
    base._review_choices = base.review_choices
  }

  const fiduciaryEntries = base.fiduciary_entries as Record<string, unknown> | undefined
  if (fiduciaryEntries && typeof fiduciaryEntries === 'object') {
    for (const [key, value] of Object.entries(fiduciaryEntries)) {
      // Hydrated contacts (including an explicit empty list) take precedence
      // over historical JSON snapshots. Otherwise opening and then saving the
      // interview can silently restore an old child or appointment.
      if (key === 'children' || key === 'additional_contacts' || key.startsWith('fid_')) {
        if (!Object.prototype.hasOwnProperty.call(base, `_${key}`)) base[`_${key}`] = value
      }
      else if (key === 'review_choices') {
        if (!base._review_choices) base._review_choices = value
      } else base[`_${key}`] = value
    }
    delete base.fiduciary_entries
  }

  if (!base._spouse && (base.spouse_first_name || base.spouse_last_name)) {
    base._spouse = {
      first_name: base.spouse_first_name ?? '',
      last_name: base.spouse_last_name ?? '',
      middle_name: base.spouse_middle_name ?? '',
      suffix: base.spouse_suffix ?? '',
      prior_names: base.spouse_prior_names ?? '',
      preferred_name: base.spouse_preferred_name ?? '',
      preferred_pronoun: base.spouse_preferred_pronoun ?? '',
      date_of_birth: base.spouse_date_of_birth ?? '',
      is_us_citizen: base.spouse_is_us_citizen ?? null,
      citizenship_status: base.spouse_citizenship_status ?? 'unknown',
      phone: formatPhoneInput(typeof base.spouse_phone === 'string' ? base.spouse_phone : ''),
      email: base.spouse_email ?? '',
    }
  }

  // The column is text, so the portal's object comes back as a JSON string —
  // normalize to the object shape before the wizard spreads into it.
  if (base.planning_objectives != null) {
    base.planning_objectives = parsePlanningObjectives(base.planning_objectives) ?? undefined
  }

  if (base.planning_goals == null && base.goals != null) base.planning_goals = base.goals
  if (base.special_notes == null && base.additional_notes != null) base.special_notes = base.additional_notes
  if (base.excluded_guardian == null && base.excluded_guardians != null) base.excluded_guardian = base.excluded_guardians
  if (base.preferred_pronoun == null && base.pronouns != null) base.preferred_pronoun = base.pronouns

  const streetAddress = typeof base.street_address === 'string' ? base.street_address.trim() : ''
  const addressLine1 = typeof base.address_line1 === 'string' ? base.address_line1.trim() : ''
  if (!streetAddress && addressLine1) base.street_address = addressLine1

  return unpackReferralDetailsFromFamilyDetails(base)
}
