import { DESIGN_SECTION_LABELS } from '@/lib/designSheetReadiness'

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

// Exact path → target. Friendly labels keep the preflight checklist readable.
const EXACT: Record<string, Entry> = {
  'client.full_name': { label: 'Client legal name', sectionId: 'personal', targetField: 'client_name' },
  'client.street_address': { label: 'Street address', sectionId: 'personal', targetField: 'street' },
  'client.city': { label: 'City', sectionId: 'personal', targetField: 'city' },
  'client.state': { label: 'State', sectionId: 'personal', targetField: 'state' },
  'client.county': { label: 'County', sectionId: 'personal', targetField: 'county' },
  'client.date_of_birth': { label: 'Date of birth', sectionId: 'personal', targetField: 'client_dob' },
  'client.pronoun_subject': { label: 'Pronouns', sectionId: 'personal', targetField: 'client_pronouns' },
  'client.pronoun_possessive': { label: 'Pronouns', sectionId: 'personal', targetField: 'client_pronouns' },

  'execution.signing_county': { label: 'Signing county', sectionId: 'personal', targetField: 'signing_county' },
  'execution.notary_commission': { label: 'Notary commission expiration', sectionId: 'personal', targetField: 'notary_commission_expiration' },
  'execution.id_type': { label: 'Client ID type', sectionId: 'personal', targetField: null },

  'spouse.full_name': { label: 'Spouse legal name', sectionId: 'family', targetField: 'spouse_name' },
  'children[].full_name': { label: 'Children', sectionId: 'family', targetField: null },
  'young_adult.parent1.full_name': { label: 'Young-adult plan parent', sectionId: 'family', targetField: null },

  'trust.name': { label: 'Trust name', sectionId: 'trust', targetField: 'trust_name' },
  'trust.date': { label: 'Trust date', sectionId: 'trust', targetField: 'trust_date' },
  'trust.descendants_distribution.method': { label: 'Distribution method', sectionId: 'trust', targetField: 'distribution_method' },
  'trust.tangible_personal_property.distribution_method': { label: 'Tangible property distribution', sectionId: 'trust', targetField: 'tangible_property_distribution' },
  'trust.contingent_beneficiary.full_name': { label: 'Contingent beneficiary', sectionId: 'trust', targetField: null },
  'trust.remote_beneficiaries.individuals': { label: 'Remote beneficiaries', sectionId: 'trust', targetField: 'remote_beneficiary' },

  'fiduciaries.trustee.primary.full_name': { label: 'Trustee', sectionId: 'trust', targetField: null },
  'fiduciaries.trustee.co_primary.full_name': { label: 'Co-trustee', sectionId: 'trust', targetField: null },
  'fiduciaries.trustee.successor.full_name': { label: 'Successor trustee', sectionId: 'trust', targetField: null },
  'fiduciaries.trustee.second_successor.full_name': { label: 'Second successor trustee', sectionId: 'trust', targetField: null },
  'fiduciaries.trustee.co_trustees_action': { label: 'Co-trustee decision standard', sectionId: 'trust', targetField: 'cotrustee_decision_standard' },

  'fiduciaries.executor.primary.full_name': { label: 'Executor / Personal Representative', sectionId: 'will', targetField: null },
  'fiduciaries.testamentary_trustee.primary.full_name': { label: 'Testamentary trustee', sectionId: 'will', targetField: null },
  'testamentary_trust.beneficiary_structure': { label: 'Testamentary trust beneficiary structure', sectionId: 'will', targetField: 'beneficiary_structure' },
  'guardians.primary.full_name': { label: 'Guardian for minor children', sectionId: 'will', targetField: null },

  'fiduciaries.agent.primary.full_name': { label: 'Financial agent (POA)', sectionId: 'dpoa', targetField: null },

  'healthcare.agent.primary.full_name': { label: 'Health care agent', sectionId: 'healthcare', targetField: null },
  'healthcare.agent.primary.address': { label: 'Health care agent address', sectionId: 'healthcare', targetField: null },
  'healthcare.agent.primary.phone': { label: 'Health care agent phone', sectionId: 'healthcare', targetField: null },
  'healthcare.agent.primary.relationship': { label: 'Health care agent relationship', sectionId: 'healthcare', targetField: null },
  'healthcare.agent.alternate.full_name': { label: 'Alternate health care agent', sectionId: 'healthcare', targetField: null },
}

// Prefix → section for paths not in EXACT (new/renamed generator fields degrade
// to a section-level link rather than breaking the checklist).
const PREFIXES: Array<[string, string]> = [
  ['fiduciaries.trustee.', 'trust'],
  ['fiduciaries.testamentary_trustee.', 'will'],
  ['fiduciaries.executor.', 'will'],
  ['fiduciaries.agent.', 'dpoa'],
  ['guardians.', 'will'],
  ['healthcare.', 'healthcare'],
  ['testamentary_trust.', 'will'],
  ['trust.', 'trust'],
  ['client.', 'personal'],
  ['execution.', 'personal'],
  ['spouse.', 'family'],
  ['children', 'family'],
  ['young_adult.', 'family'],
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

  // Last resort: send the attorney to plan design with a humanized label.
  return { path, label: humanize(path), sectionId: 'plan-design', sectionLabel: sectionLabel('plan-design'), targetField: null }
}

/** True when a section id is one the design sheet actually renders. */
export function isKnownDesignSection(sectionId: string): boolean {
  return sectionId in DESIGN_SECTION_LABELS
}
