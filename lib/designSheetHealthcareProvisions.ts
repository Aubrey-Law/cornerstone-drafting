import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type AnatomicalGiftPreference = 'yes' | 'defer' | 'no'
export type AdvanceDirectiveChoice = 'prolong_life' | 'do_not_resuscitate' | 'do_not_prolong_life'
export type HipaaFiduciaryListing = 'by_name' | 'general_language'

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
