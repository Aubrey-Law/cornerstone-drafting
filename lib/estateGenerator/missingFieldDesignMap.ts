import { DESIGN_SECTION_LABELS } from '@/lib/designSheetReadiness'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'

// Maps a generator field path (as returned by the draft preflight's `missing[]`,
// e.g. `fiduciaries.trustee.successor.full_name`) to the design-sheet section
// and field the attorney should open to fill it. `targetField` is a DesignSheet
// column whose input renders `id="design-field-<col>"`; null means scroll to the
// section (used for fiduciary slot pickers and array/structural fields that have
// no single focusable input).

export interface MissingFieldTarget {
  path: string
  label: string
  sectionId: string
  sectionLabel: string
  targetField: string | null
}

interface Entry {
  label: string
  sectionId: string
  targetField: string | null
}

const S = DESIGN_SECTION_IDS

// Exact path → target. Friendly labels keep the preflight checklist readable.
const EXACT: Record<string, Entry> = {
  'client.full_name': { label: 'Client legal name', sectionId: S.clientInformation, targetField: 'client_name' },
  'client.street_address': { label: 'Street address', sectionId: S.clientInformation, targetField: 'street' },
  'client.city': { label: 'City', sectionId: S.clientInformation, targetField: 'city' },
  'client.state': { label: 'State', sectionId: S.clientInformation, targetField: 'state' },
  'client.county': { label: 'County', sectionId: S.clientInformation, targetField: 'county' },
  'client.date_of_birth': { label: 'Date of birth', sectionId: S.clientInformation, targetField: 'client_dob' },
  'client.pronoun_subject': { label: 'Pronouns', sectionId: S.clientInformation, targetField: 'client_pronouns' },
  'client.pronoun_possessive': { label: 'Pronouns', sectionId: S.clientInformation, targetField: 'client_pronouns' },

  'execution.signing_county': { label: 'Signing county', sectionId: S.estatePlanDesign, targetField: 'signing_county' },
  'execution.notary_commission': { label: 'Notary commission expiration', sectionId: S.estatePlanDesign, targetField: 'notary_commission_expiration' },
  'execution.id_type': { label: 'Client ID type', sectionId: S.clientInformation, targetField: null },

  'spouse.full_name': { label: 'Spouse legal name', sectionId: S.clientInformation, targetField: 'spouse_name' },
  'children[].full_name': { label: 'Children', sectionId: S.familyInformation, targetField: null },
  'young_adult.parent1.full_name': { label: 'Young-adult plan parent', sectionId: S.familyInformation, targetField: null },

  'trust.name': { label: 'Trust name', sectionId: S.trustDetails, targetField: 'trust_name' },
  'trust.date': { label: 'Trust date', sectionId: S.trustDetails, targetField: 'trust_date' },
  'trust.descendants_distribution.method': { label: 'Distribution method', sectionId: S.trustDetails, targetField: 'distribution_method' },
  'trust.tangible_personal_property.distribution_method': { label: 'Tangible property distribution', sectionId: S.estatePlanDesign, targetField: 'tangible_property_distribution' },
  'trust.contingent_beneficiary.full_name': { label: 'Contingent beneficiary', sectionId: S.familyInformation, targetField: null },
  'trust.remote_beneficiaries.individuals': { label: 'Remote beneficiaries', sectionId: S.familyInformation, targetField: 'remote_beneficiary' },

  'fiduciaries.trustee.primary.full_name': { label: 'Trustee', sectionId: S.fiduciaries, targetField: null },
  'fiduciaries.trustee.co_primary.full_name': { label: 'Co-trustee', sectionId: S.fiduciaries, targetField: null },
  'fiduciaries.trustee.successor.full_name': { label: 'Successor trustee', sectionId: S.fiduciaries, targetField: null },
  'fiduciaries.trustee.second_successor.full_name': { label: 'Second successor trustee', sectionId: S.fiduciaries, targetField: null },
  'fiduciaries.trustee.co_trustees_action': { label: 'Co-trustee decision standard', sectionId: S.fiduciaries, targetField: 'cotrustee_decision_standard' },

  'fiduciaries.executor.primary.full_name': { label: 'Executor / Personal Representative', sectionId: S.fiduciaries, targetField: null },
  'fiduciaries.testamentary_trustee.primary.full_name': { label: 'Testamentary trustee', sectionId: S.fiduciaries, targetField: null },
  'testamentary_trust.beneficiary_structure': { label: 'Testamentary trust beneficiary structure', sectionId: S.willDetails, targetField: 'beneficiary_structure' },
  'guardians.primary.full_name': { label: 'Guardian for minor children', sectionId: S.fiduciaries, targetField: null },

  'fiduciaries.agent.primary.full_name': { label: 'Financial agent (POA)', sectionId: S.fiduciaries, targetField: null },

  'healthcare.agent.primary.full_name': { label: 'Health care agent', sectionId: S.fiduciaries, targetField: null },
  'healthcare.agent.primary.address': { label: 'Health care agent address', sectionId: S.fiduciaries, targetField: null },
  'healthcare.agent.primary.phone': { label: 'Health care agent phone', sectionId: S.fiduciaries, targetField: null },
  'healthcare.agent.primary.relationship': { label: 'Health care agent relationship', sectionId: S.fiduciaries, targetField: null },
  'healthcare.agent.alternate.full_name': { label: 'Alternate health care agent', sectionId: S.fiduciaries, targetField: null },
}

// Prefix → section for paths not in EXACT (new/renamed generator fields degrade
// to a section-level link rather than breaking the checklist).
const PREFIXES: Array<[string, string]> = [
  ['fiduciaries.trustee.', S.fiduciaries],
  ['fiduciaries.testamentary_trustee.', S.fiduciaries],
  ['fiduciaries.executor.', S.fiduciaries],
  ['fiduciaries.agent.', S.fiduciaries],
  ['guardians.', S.fiduciaries],
  ['healthcare.', S.healthcareDirectives],
  ['testamentary_trust.', S.willDetails],
  ['trust.', S.trustDetails],
  ['client.', S.clientInformation],
  ['execution.', S.estatePlanDesign],
  ['spouse.', S.clientInformation],
  ['children', S.familyInformation],
  ['young_adult.', S.familyInformation],
]

function humanize(path: string): string {
  const last = path.replace(/\[\]/g, '').split('.').pop() ?? path
  return last.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function sectionLabel(sectionId: string): string {
  return DESIGN_SECTION_LABELS[sectionId] ?? sectionId
}

export function designTargetForMissingField(path: string): MissingFieldTarget {
  const exact = EXACT[path]
  if (exact) return { path, ...exact, sectionLabel: sectionLabel(exact.sectionId) }

  for (const [prefix, sectionId] of PREFIXES) {
    if (path.startsWith(prefix)) {
      return { path, label: humanize(path), sectionId, sectionLabel: sectionLabel(sectionId), targetField: null }
    }
  }

  return {
    path,
    label: humanize(path),
    sectionId: S.estatePlanDesign,
    sectionLabel: sectionLabel(S.estatePlanDesign),
    targetField: null,
  }
}

/** True when a section id is one the design sheet actually renders. */
export function isKnownDesignSection(sectionId: string): boolean {
  return sectionId in DESIGN_SECTION_LABELS
}
