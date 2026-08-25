import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type AnatomicalGiftPreference = 'yes' | 'defer' | 'no'
export type AdvanceDirectiveChoice = 'prolong_life' | 'do_not_resuscitate' | 'do_not_prolong_life'
export type HipaaFiduciaryListing = 'by_name' | 'general_language'

/** How co-agents settle a disagreement over a health care decision. */
export type CoagentDisagreementResolution = 'omit' | 'majority' | 'unanimous' | 'first_named'

export const COAGENT_DISAGREEMENT_RESOLUTIONS: readonly CoagentDisagreementResolution[] =
  ['omit', 'majority', 'unanimous', 'first_named'] as const

/** What should happen to a settlor's remains. */
export type DispositionOfRemains =
  | 'cremation'
  | 'chemical_cremation'
  | 'burial'
  | 'no_specific_wishes'
  | 'leave_blank'
  | 'other'

export const DISPOSITIONS_OF_REMAINS: readonly DispositionOfRemains[] =
  ['cremation', 'chemical_cremation', 'burial', 'no_specific_wishes', 'leave_blank', 'other'] as const

export interface DesignSheetHealthcareProvisions {
  client_anatomical_gift: AnatomicalGiftPreference | null
  spouse_anatomical_gift: AnatomicalGiftPreference | null
  spouse_anatomical_restrictions: string | null
  client_advance_directive: AdvanceDirectiveChoice | null
  spouse_advance_directive: AdvanceDirectiveChoice | null
  hipaa_include_poa: boolean
  hipaa_include_trustees: boolean
  hipaa_list_fiduciaries_by_name: HipaaFiduciaryListing | null
  /** @deprecated Prefer client_hipaa_additional_agent_contact_ids; kept for read/write compat. */
  hipaa_additional_agent_contact_ids: string[]
  client_hipaa_additional_agent_contact_ids: string[]
  spouse_hipaa_additional_agent_contact_ids: string[]
  /** Document-level: the proxy carries the statutory notice page. */
  include_hcp_notice_page: boolean
  client_leave_instructions_blank: boolean
  client_receive_comfort_care: boolean
  client_wish_to_die_at_home: boolean
  client_decline_autopsy: boolean
  client_agent_effective_immediately: boolean
  client_include_post_death_authority: boolean
  client_preference_for_donations: boolean
  client_prohibit_ai_replicas: boolean
  client_disposition_agents_same_as_healthcare: boolean
  client_include_disposition_agent_acceptance: boolean
  client_other_healthcare_wishes: string | null
  client_agent_limits_while_living: string | null
  client_agent_limits_after_death: string | null
  client_funeral_instructions: string | null
  client_preneed_arrangements: string | null
  client_other_disposition_instructions: string | null
  client_coagent_disagreement_resolution: CoagentDisagreementResolution | null
  client_disposition_of_remains: DispositionOfRemains | null
  spouse_leave_instructions_blank: boolean
  spouse_receive_comfort_care: boolean
  spouse_wish_to_die_at_home: boolean
  spouse_decline_autopsy: boolean
  spouse_agent_effective_immediately: boolean
  spouse_include_post_death_authority: boolean
  spouse_preference_for_donations: boolean
  spouse_prohibit_ai_replicas: boolean
  spouse_disposition_agents_same_as_healthcare: boolean
  spouse_include_disposition_agent_acceptance: boolean
  spouse_other_healthcare_wishes: string | null
  spouse_agent_limits_while_living: string | null
  spouse_agent_limits_after_death: string | null
  spouse_funeral_instructions: string | null
  spouse_preneed_arrangements: string | null
  spouse_other_disposition_instructions: string | null
  spouse_coagent_disagreement_resolution: CoagentDisagreementResolution | null
  spouse_disposition_of_remains: DispositionOfRemains | null
}

const DEFAULT_HEALTHCARE_PROVISIONS: DesignSheetHealthcareProvisions = {
  client_anatomical_gift: null,
  spouse_anatomical_gift: null,
  spouse_anatomical_restrictions: null,
  client_advance_directive: null,
  spouse_advance_directive: null,
  hipaa_include_poa: false,
  hipaa_include_trustees: false,
  hipaa_list_fiduciaries_by_name: null,
  hipaa_additional_agent_contact_ids: [],
  client_hipaa_additional_agent_contact_ids: [],
  spouse_hipaa_additional_agent_contact_ids: [],
  include_hcp_notice_page: false,
  client_leave_instructions_blank: false,
  client_receive_comfort_care: false,
  client_wish_to_die_at_home: false,
  client_decline_autopsy: false,
  client_agent_effective_immediately: false,
  client_include_post_death_authority: false,
  client_preference_for_donations: false,
  client_prohibit_ai_replicas: false,
  client_disposition_agents_same_as_healthcare: false,
  client_include_disposition_agent_acceptance: false,
  client_other_healthcare_wishes: null,
  client_agent_limits_while_living: null,
  client_agent_limits_after_death: null,
  client_funeral_instructions: null,
  client_preneed_arrangements: null,
  client_other_disposition_instructions: null,
  client_coagent_disagreement_resolution: null,
  client_disposition_of_remains: null,
  spouse_leave_instructions_blank: false,
  spouse_receive_comfort_care: false,
  spouse_wish_to_die_at_home: false,
  spouse_decline_autopsy: false,
  spouse_agent_effective_immediately: false,
  spouse_include_post_death_authority: false,
  spouse_preference_for_donations: false,
  spouse_prohibit_ai_replicas: false,
  spouse_disposition_agents_same_as_healthcare: false,
  spouse_include_disposition_agent_acceptance: false,
  spouse_other_healthcare_wishes: null,
  spouse_agent_limits_while_living: null,
  spouse_agent_limits_after_death: null,
  spouse_funeral_instructions: null,
  spouse_preneed_arrangements: null,
  spouse_other_disposition_instructions: null,
  spouse_coagent_disagreement_resolution: null,
  spouse_disposition_of_remains: null,
}

function healthcareProvisionsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.healthcare_provisions
  return isRecord(raw) ? raw : {}
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof raw[key] === 'boolean' ? raw[key] : fallback
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readAnatomicalGift(raw: Record<string, unknown>, key: string): AnatomicalGiftPreference | null {
  const value = raw[key]
  if (value === 'yes' || value === 'defer' || value === 'no') return value
  return null
}

function readAdvanceDirective(raw: Record<string, unknown>, key: string): AdvanceDirectiveChoice | null {
  const value = raw[key]
  if (value === 'prolong_life' || value === 'do_not_resuscitate' || value === 'do_not_prolong_life') return value
  return null
}

function readHipaaListing(raw: Record<string, unknown>): HipaaFiduciaryListing | null {
  const value = raw.hipaa_list_fiduciaries_by_name
  if (value === 'by_name' || value === 'general_language') return value
  return null
}

/**
 * A choice the attorney has not made reads back as null, and a stored value
 * outside the allowed list reads as null too rather than as a bogus enum.
 */
function readAllowed<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = raw[key]
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function readContactIdList(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Prefer per-party lists; migrate legacy shared list onto the client side. */
function readClientHipaaAdditionalAgents(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.client_hipaa_additional_agent_contact_ids)) {
    return readContactIdList(raw, 'client_hipaa_additional_agent_contact_ids')
  }
  return readContactIdList(raw, 'hipaa_additional_agent_contact_ids')
}

export function anatomicalGiftFromLegacy(value: string | null | undefined): AnatomicalGiftPreference | null {
  if (value === 'all') return 'yes'
  if (value === 'none') return 'no'
  if (value === 'specified') return 'yes'
  if (value === 'defer') return 'defer'
  return null
}

export function anatomicalGiftToLegacy(value: AnatomicalGiftPreference | null): DesignSheet['hcp_anatomical_gift'] {
  if (value === 'yes') return 'all'
  if (value === 'no') return 'none'
  return null
}

export function getDesignSheetHealthcareProvisions(
  sheet: Pick<DesignSheet, 'decisions' | 'hcp_anatomical_gift'>,
): DesignSheetHealthcareProvisions {
  const raw = healthcareProvisionsRaw(sheet)

  return {
    client_anatomical_gift: readAnatomicalGift(raw, 'client_anatomical_gift')
      ?? anatomicalGiftFromLegacy(sheet.hcp_anatomical_gift),
    spouse_anatomical_gift: readAnatomicalGift(raw, 'spouse_anatomical_gift'),
    spouse_anatomical_restrictions: readString(raw, 'spouse_anatomical_restrictions'),
    client_advance_directive: readAdvanceDirective(raw, 'client_advance_directive'),
    spouse_advance_directive: readAdvanceDirective(raw, 'spouse_advance_directive'),
    hipaa_include_poa: readBoolean(raw, 'hipaa_include_poa', DEFAULT_HEALTHCARE_PROVISIONS.hipaa_include_poa),
    hipaa_include_trustees: readBoolean(raw, 'hipaa_include_trustees', DEFAULT_HEALTHCARE_PROVISIONS.hipaa_include_trustees),
    hipaa_list_fiduciaries_by_name: readHipaaListing(raw),
    client_hipaa_additional_agent_contact_ids: readClientHipaaAdditionalAgents(raw),
    spouse_hipaa_additional_agent_contact_ids: readContactIdList(raw, 'spouse_hipaa_additional_agent_contact_ids'),
    // Mirror client list for callers still reading the legacy key.
    hipaa_additional_agent_contact_ids: readClientHipaaAdditionalAgents(raw),
    include_hcp_notice_page: readBoolean(raw, 'include_hcp_notice_page', DEFAULT_HEALTHCARE_PROVISIONS.include_hcp_notice_page),
    client_leave_instructions_blank: readBoolean(raw, 'client_leave_instructions_blank', DEFAULT_HEALTHCARE_PROVISIONS.client_leave_instructions_blank),
    client_receive_comfort_care: readBoolean(raw, 'client_receive_comfort_care', DEFAULT_HEALTHCARE_PROVISIONS.client_receive_comfort_care),
    client_wish_to_die_at_home: readBoolean(raw, 'client_wish_to_die_at_home', DEFAULT_HEALTHCARE_PROVISIONS.client_wish_to_die_at_home),
    client_decline_autopsy: readBoolean(raw, 'client_decline_autopsy', DEFAULT_HEALTHCARE_PROVISIONS.client_decline_autopsy),
    client_agent_effective_immediately: readBoolean(raw, 'client_agent_effective_immediately', DEFAULT_HEALTHCARE_PROVISIONS.client_agent_effective_immediately),
    client_include_post_death_authority: readBoolean(raw, 'client_include_post_death_authority', DEFAULT_HEALTHCARE_PROVISIONS.client_include_post_death_authority),
    client_preference_for_donations: readBoolean(raw, 'client_preference_for_donations', DEFAULT_HEALTHCARE_PROVISIONS.client_preference_for_donations),
    client_prohibit_ai_replicas: readBoolean(raw, 'client_prohibit_ai_replicas', DEFAULT_HEALTHCARE_PROVISIONS.client_prohibit_ai_replicas),
    client_disposition_agents_same_as_healthcare: readBoolean(raw, 'client_disposition_agents_same_as_healthcare', DEFAULT_HEALTHCARE_PROVISIONS.client_disposition_agents_same_as_healthcare),
    client_include_disposition_agent_acceptance: readBoolean(raw, 'client_include_disposition_agent_acceptance', DEFAULT_HEALTHCARE_PROVISIONS.client_include_disposition_agent_acceptance),
    client_other_healthcare_wishes: readString(raw, 'client_other_healthcare_wishes'),
    client_agent_limits_while_living: readString(raw, 'client_agent_limits_while_living'),
    client_agent_limits_after_death: readString(raw, 'client_agent_limits_after_death'),
    client_funeral_instructions: readString(raw, 'client_funeral_instructions'),
    client_preneed_arrangements: readString(raw, 'client_preneed_arrangements'),
    client_other_disposition_instructions: readString(raw, 'client_other_disposition_instructions'),
    client_coagent_disagreement_resolution: readAllowed(raw, 'client_coagent_disagreement_resolution', COAGENT_DISAGREEMENT_RESOLUTIONS),
    client_disposition_of_remains: readAllowed(raw, 'client_disposition_of_remains', DISPOSITIONS_OF_REMAINS),
    spouse_leave_instructions_blank: readBoolean(raw, 'spouse_leave_instructions_blank', DEFAULT_HEALTHCARE_PROVISIONS.spouse_leave_instructions_blank),
    spouse_receive_comfort_care: readBoolean(raw, 'spouse_receive_comfort_care', DEFAULT_HEALTHCARE_PROVISIONS.spouse_receive_comfort_care),
    spouse_wish_to_die_at_home: readBoolean(raw, 'spouse_wish_to_die_at_home', DEFAULT_HEALTHCARE_PROVISIONS.spouse_wish_to_die_at_home),
    spouse_decline_autopsy: readBoolean(raw, 'spouse_decline_autopsy', DEFAULT_HEALTHCARE_PROVISIONS.spouse_decline_autopsy),
    spouse_agent_effective_immediately: readBoolean(raw, 'spouse_agent_effective_immediately', DEFAULT_HEALTHCARE_PROVISIONS.spouse_agent_effective_immediately),
    spouse_include_post_death_authority: readBoolean(raw, 'spouse_include_post_death_authority', DEFAULT_HEALTHCARE_PROVISIONS.spouse_include_post_death_authority),
    spouse_preference_for_donations: readBoolean(raw, 'spouse_preference_for_donations', DEFAULT_HEALTHCARE_PROVISIONS.spouse_preference_for_donations),
    spouse_prohibit_ai_replicas: readBoolean(raw, 'spouse_prohibit_ai_replicas', DEFAULT_HEALTHCARE_PROVISIONS.spouse_prohibit_ai_replicas),
    spouse_disposition_agents_same_as_healthcare: readBoolean(raw, 'spouse_disposition_agents_same_as_healthcare', DEFAULT_HEALTHCARE_PROVISIONS.spouse_disposition_agents_same_as_healthcare),
    spouse_include_disposition_agent_acceptance: readBoolean(raw, 'spouse_include_disposition_agent_acceptance', DEFAULT_HEALTHCARE_PROVISIONS.spouse_include_disposition_agent_acceptance),
    spouse_other_healthcare_wishes: readString(raw, 'spouse_other_healthcare_wishes'),
    spouse_agent_limits_while_living: readString(raw, 'spouse_agent_limits_while_living'),
    spouse_agent_limits_after_death: readString(raw, 'spouse_agent_limits_after_death'),
    spouse_funeral_instructions: readString(raw, 'spouse_funeral_instructions'),
    spouse_preneed_arrangements: readString(raw, 'spouse_preneed_arrangements'),
    spouse_other_disposition_instructions: readString(raw, 'spouse_other_disposition_instructions'),
    spouse_coagent_disagreement_resolution: readAllowed(raw, 'spouse_coagent_disagreement_resolution', COAGENT_DISAGREEMENT_RESOLUTIONS),
    spouse_disposition_of_remains: readAllowed(raw, 'spouse_disposition_of_remains', DISPOSITIONS_OF_REMAINS),
  }
}

export function setDesignSheetHealthcareProvisions(
  sheet: Pick<DesignSheet, 'decisions' | 'hcp_anatomical_gift'>,
  patch: Partial<DesignSheetHealthcareProvisions>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = getDesignSheetHealthcareProvisions(sheet)
  const next: DesignSheetHealthcareProvisions = {
    ...current,
    ...patch,
  }

  // Keep legacy key in sync with the client list so older readers stay correct.
  if (
    patch.client_hipaa_additional_agent_contact_ids !== undefined
    || patch.hipaa_additional_agent_contact_ids !== undefined
  ) {
    const clientIds = patch.client_hipaa_additional_agent_contact_ids
      ?? patch.hipaa_additional_agent_contact_ids
      ?? next.client_hipaa_additional_agent_contact_ids
    next.client_hipaa_additional_agent_contact_ids = clientIds
    next.hipaa_additional_agent_contact_ids = clientIds
  }

  return {
    ...decisions,
    healthcare_provisions: next,
  }
}
