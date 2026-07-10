import {
  anatomicalGiftToLegacy,
  getDesignSheetHealthcareProvisions,
  type AdvanceDirectiveChoice,
  type AnatomicalGiftPreference,
  type DesignSheetHealthcareProvisions,
  type HipaaFiduciaryListing,
} from '@/lib/designSheetHealthcareProvisions'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'
import { resolveContactDetails } from '@/lib/draftPayload/fiduciaryDetails'

export interface DraftPayloadHealthcareProvisions extends DesignSheetHealthcareProvisions {
  client_hipaa_additional_agents: ReturnType<typeof resolveContactDetails>
  spouse_hipaa_additional_agents: ReturnType<typeof resolveContactDetails>
}

export interface DraftPayloadHcpProvisions {
  anatomical_gift: 'all' | 'specified' | 'none' | null
  anatomical_specified: string | null
  client_anatomical_gift?: AnatomicalGiftPreference | null
  spouse_anatomical_gift?: AnatomicalGiftPreference | null
  spouse_anatomical_restrictions?: string | null
  client_advance_directive?: AdvanceDirectiveChoice | null
  spouse_advance_directive?: AdvanceDirectiveChoice | null
}

export interface DraftPayloadHipaaProvisions {
  psychotherapy_notes: 'authorize' | 'do_not_authorize' | null
  include_poa?: boolean
  include_trustees?: boolean
  list_fiduciaries_by_name?: HipaaFiduciaryListing | null
  client_additional_agents?: ReturnType<typeof resolveContactDetails>
  spouse_additional_agents?: ReturnType<typeof resolveContactDetails>
}

function legacyAnatomicalGift(
  preference: AnatomicalGiftPreference | null,
  legacyColumn: string | null | undefined,
  legacySpecified: string | null | undefined,
): DraftPayloadHcpProvisions['anatomical_gift'] {
  const fromPreference = anatomicalGiftToLegacy(preference)
  if (fromPreference) {
    if (fromPreference === 'all' && legacySpecified?.trim()) return 'specified'
    return fromPreference
  }

  const legacy = legacyColumn?.trim().toLowerCase()
  if (legacy === 'all' || legacy === 'specified' || legacy === 'none') {
    return legacy
  }
  return null
}

export function draftPayloadHealthcare(
  designSheet: DesignSheetRow,
  contacts: ContactRow[],
): {
  healthcare_provisions: DraftPayloadHealthcareProvisions
  hcp_provisions: DraftPayloadHcpProvisions
  hipaa_provisions: DraftPayloadHipaaProvisions
} {
  const provisions = getDesignSheetHealthcareProvisions(designSheet)
  const clientHipaaAgents = resolveContactDetails(
    provisions.client_hipaa_additional_agent_contact_ids,
    contacts,
    designSheet,
    'client',
  )
  const spouseHipaaAgents = resolveContactDetails(
    provisions.spouse_hipaa_additional_agent_contact_ids,
    contacts,
    designSheet,
    'spouse',
  )

  const anatomicalSpecified = designSheet.hcp_anatomical_specified?.trim() || null

  return {
    healthcare_provisions: {
      ...provisions,
      client_hipaa_additional_agents: clientHipaaAgents,
      spouse_hipaa_additional_agents: spouseHipaaAgents,
    },
    hcp_provisions: {
      anatomical_gift: legacyAnatomicalGift(
        provisions.client_anatomical_gift,
        designSheet.hcp_anatomical_gift,
        designSheet.hcp_anatomical_specified,
      ),
      anatomical_specified: anatomicalSpecified,
      client_anatomical_gift: provisions.client_anatomical_gift,
      spouse_anatomical_gift: provisions.spouse_anatomical_gift,
      spouse_anatomical_restrictions: provisions.spouse_anatomical_restrictions,
      client_advance_directive: provisions.client_advance_directive,
      spouse_advance_directive: provisions.spouse_advance_directive,
    },
    hipaa_provisions: {
      psychotherapy_notes: (designSheet.hipaa_psychotherapy_notes as DraftPayloadHipaaProvisions['psychotherapy_notes']) ?? null,
      include_poa: provisions.hipaa_include_poa,
      include_trustees: provisions.hipaa_include_trustees,
      list_fiduciaries_by_name: provisions.hipaa_list_fiduciaries_by_name,
      client_additional_agents: clientHipaaAgents,
      spouse_additional_agents: spouseHipaaAgents,
    },
  }
}
