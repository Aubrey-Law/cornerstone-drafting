import {
  getEstatePlanDesignSetup,
  type DesignDocumentInclusions,
  type EstatePlanDesignSetup,
  type TrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import { getPersistedRealEstateTransfer } from '@/lib/designSheetRealEstateTransfer'
import { normalizePracticeArea } from '@/lib/practiceArea'
import type { DraftPayload } from '@/lib/draftPayload/types'
import type { ContactRow, DesignSheetRow, FiduciarySlotRow } from '@/lib/draftPayload/types'

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ')
}

/** Pick the first non-null, non-empty value from an array of candidates. */
export function pick(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v != null && v !== '') return v
  }
  return null
}

export function decisionString(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null,
  key: string,
): string | null {
  const value = designSheet?.decisions?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** Return a contact's full name string, or null if no useful name exists. */
function contactName(c: ContactRow): string | null {
  const name = fullName(c.first_name, c.last_name)
  return name || null
}

/** Return a contact's relationship to the client (e.g. "Spouse", "Brother"). */
function contactRelationship(c: ContactRow): string | null {
  const label = c.relationship_label?.trim()
  if (label) return label
  const type = c.relationship_type?.trim()
  return type || null
}

function isFiduciarySlotArray(value: unknown): value is FiduciarySlotRow[] {
  return Array.isArray(value) && value.every(slot => {
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) return false
    const row = slot as Record<string, unknown>
    return typeof row.id === 'string' &&
      (typeof row.contact_id === 'string' || row.contact_id === null) &&
      typeof row.is_co === 'boolean' &&
      typeof row.order === 'number'
  })
}

function getDesignSlots(designSheet: DesignSheetRow | null, key: keyof Pick<
  DesignSheetRow,
  | 'trustee_slots'
  | 'executor_slots'
  | 'poa_slots'
  | 'hcp_slots'
  | 'guardian_slots'
  | 'temporary_guardian_slots'
  | 'spouse_trustee_slots'
  | 'spouse_executor_slots'
  | 'spouse_poa_slots'
  | 'spouse_hcp_slots'
>): FiduciarySlotRow[] {
  const direct = designSheet?.[key]
  if (isFiduciarySlotArray(direct)) return direct
  const fromDecisions = designSheet?.decisions?.[key]
  return isFiduciarySlotArray(fromDecisions) ? fromDecisions : []
}

export function designSheetForDocumentInclusions(designSheet: DesignSheetRow | null) {
  return {
    plan_type: designSheet?.plan_type ?? null,
    marital_status: designSheet?.marital_status ?? null,
    decisions: designSheet?.decisions ?? null,
    children: designSheet?.children ?? null,
  }
}

/**
 * Resolve a child's display name from either the composed `name` field or the
 * first/middle/last shape (some rows store the intake shape). Guards against
 * `undefined` so a malformed child can never crash draft generation.
 */
function childFullName(child: Record<string, unknown>): string {
  const composed = typeof child.name === 'string' ? child.name.trim() : ''
  if (composed) return composed
  return [child.first_name, child.middle_name, child.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map(part => part.trim())
    .join(' ')
}

export function draftPayloadChildren(designSheet: Pick<DesignSheetRow, 'children'> | null): DraftPayload['children'] {
  const children = Array.isArray(designSheet?.children) ? designSheet.children : []

  return children
    .map(child => ({
      full_name: childFullName((child ?? {}) as unknown as Record<string, unknown>),
      dob: child?.dob ?? null,
      relationship: child?.relationship ?? null,
      parentage: child?.parentage ?? null,
      gender: child?.gender ?? null,
      deceased: child?.deceased === true,
      minor: child?.is_minor === true,
    }))
    .filter(child => child.full_name.length > 0)
}

/**
 * Build fiduciary slot map from contact_roles.
 *
 * Roles: trustee | executor | poa | hcp | guardian
 * for_party: client | spouse
 * priority: 1 = primary, 2 = successor/alt1, 3 = second successor/alt2
 * is_coagent: true = co-agent (serves simultaneously with primary)
 */
export function buildFiduciarySlots(contacts: ContactRow[]): DraftPayload['fiduciaries'] {
  // Slot: [role, for_party, priority, is_coagent] → slot key
  type Slot = {
    name: string | null
    address: string | null
    relationship: string | null
  }

  const slots: Record<string, Slot> = {}

  for (const contact of contacts) {
    for (const role of contact.contact_roles) {
      // contact_roles stores the PR role under both 'executor' (plan-review
      // wizard) and 'personal_rep' (admin intake sheet); slots are keyed on
      // 'executor', so fold them together here.
      const roleKey = role.role === 'personal_rep' ? 'executor' : role.role
      const key = `${roleKey}_${role.for_party}_${role.priority}_${role.is_coagent ? 'co' : 'seq'}`
      slots[key] = {
        name: contactName(contact),
        address: contact.address_line1 ?? null,
        relationship: contactRelationship(contact),
      }
    }
  }

  function get(role: string, party: string, priority: number, co = false): string | null {
    return slots[`${role}_${party}_${priority}_${co ? 'co' : 'seq'}`]?.name ?? null
  }

  function getAddr(role: string, party: string, priority: number): string | null {
    return slots[`${role}_${party}_${priority}_seq`]?.address ??
           slots[`${role}_${party}_${priority}_co`]?.address ?? null
  }

  function getRel(role: string, party: string, priority: number): string | null {
    return slots[`${role}_${party}_${priority}_seq`]?.relationship ??
           slots[`${role}_${party}_${priority}_co`]?.relationship ?? null
  }

  return {
    // Client — executor / PR
    pr_primary:          get('executor', 'client', 1),
    pr_co_primary:       get('executor', 'client', 1, true),
    pr_successor:        get('executor', 'client', 2),
    pr_co_successor:     get('executor', 'client', 2, true),
    pr_second_successor: get('executor', 'client', 3),
    // Client — DPOA / POA
    dpoa_primary:  get('poa', 'client', 1),
    dpoa_co_agent: get('poa', 'client', 1, true),
    dpoa_successor: get('poa', 'client', 2),
    // Client — HCP
    hcp_primary:              get('hcp', 'client', 1),
    hcp_primary_address:      getAddr('hcp', 'client', 1),
    hcp_primary_relationship: getRel('hcp', 'client', 1),
    hcp_successor:              get('hcp', 'client', 2),
    hcp_successor_address:      getAddr('hcp', 'client', 2),
    hcp_successor_relationship: getRel('hcp', 'client', 2),
    // Client — trustee
    trustee_initial:              get('trustee', 'client', 1),
    trustee_co:                   get('trustee', 'client', 1, true),
    trustee_successor:            get('trustee', 'client', 2),
    trustee_co_successor:         get('trustee', 'client', 2, true),
    trustee_second_successor:     get('trustee', 'client', 3),
    trustee_co_second_successor:  get('trustee', 'client', 3, true),
    // Guardian
    guardian_primary:          get('guardian', 'client', 1),
    guardian_successor:        get('guardian', 'client', 2),
    guardian_second_successor: get('guardian', 'client', 3),
    // Temporary Guardian — design-sheet only (no contact_role); filled by slot overlay
    temp_guardian_primary:          null,
    temp_guardian_successor:        null,
    temp_guardian_second_successor: null,
    // Spouse — executor / PR
    spouse_pr_primary:   get('executor', 'spouse', 1),
    spouse_pr_successor: get('executor', 'spouse', 2),
    // Spouse — DPOA / POA
    spouse_dpoa_primary:   get('poa', 'spouse', 1),
    spouse_dpoa_successor: get('poa', 'spouse', 2),
    // Spouse — HCP
    spouse_hcp_primary:              get('hcp', 'spouse', 1),
    spouse_hcp_primary_address:      getAddr('hcp', 'spouse', 1),
    spouse_hcp_primary_relationship: getRel('hcp', 'spouse', 1),
    spouse_hcp_successor:              get('hcp', 'spouse', 2),
    spouse_hcp_successor_address:      getAddr('hcp', 'spouse', 2),
    spouse_hcp_successor_relationship: getRel('hcp', 'spouse', 2),
    // Spouse — trustee
    spouse_trustee_successor: get('trustee', 'spouse', 2),
  }
}

export function overlayDesignSheetFiduciarySlots(
  base: DraftPayload['fiduciaries'],
  contacts: ContactRow[],
  designSheet: DesignSheetRow | null,
  client: { full_name: string; address: string | null },
  spouse: { full_name: string; address: string | null } | null,
): DraftPayload['fiduciaries'] {
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]))
  const next = { ...base }

  function slotContact(slots: FiduciarySlotRow[], order: number, co = false): ContactRow | null {
    const slot = slots.find(item => item.order === order && item.is_co === co)
    return slot?.contact_id ? contactsById.get(slot.contact_id) ?? null : null
  }

  function slotNames(slots: FiduciarySlotRow[], order: number, co = false): string | null | undefined {
    const matchingSlots = slots.filter(item => item.order === order && item.is_co === co)
    if (matchingSlots.length === 0) return undefined
    const names = matchingSlots.map(slot => {
      if (slot?.contact_id === CLIENT_PRIMARY_CONTACT_ID) return client.full_name || null
      if (slot?.contact_id === SPOUSE_PRIMARY_CONTACT_ID) return spouse?.full_name || null
      const contact = slot.contact_id ? contactsById.get(slot.contact_id) ?? null : null
      return contact ? contactName(contact) : null
    }).filter((name): name is string => Boolean(name))
    return names.length > 0 ? names.join(', ') : null
  }

  function slotAddress(slots: FiduciarySlotRow[], order: number): string | null | undefined {
    const slot = slots.find(item => item.order === order && !item.is_co)
    if (slot?.contact_id === CLIENT_PRIMARY_CONTACT_ID) return client.address
    if (slot?.contact_id === SPOUSE_PRIMARY_CONTACT_ID) return spouse?.address ?? null
    const contact = slotContact(slots, order)
    return contact ? contact.address_line1 ?? null : undefined
  }

  function slotRelationship(slots: FiduciarySlotRow[], order: number): string | null | undefined {
    const slot = slots.find(item => item.order === order && !item.is_co)
    // The client or spouse named as their counterpart's agent is a "Spouse".
    if (slot?.contact_id === CLIENT_PRIMARY_CONTACT_ID || slot?.contact_id === SPOUSE_PRIMARY_CONTACT_ID) {
      return 'Spouse'
    }
    const contact = slotContact(slots, order)
    return contact ? contactRelationship(contact) : undefined
  }

  function applyName<K extends keyof DraftPayload['fiduciaries']>(
    key: K,
    slots: FiduciarySlotRow[],
    order: number,
    co = false,
  ) {
    const value = slotNames(slots, order, co)
    if (value !== undefined) next[key] = value
  }

  const trustee = getDesignSlots(designSheet, 'trustee_slots')
  applyName('trustee_initial', trustee, 0)
  applyName('trustee_co', trustee, 0, true)
  applyName('trustee_successor', trustee, 1)
  applyName('trustee_co_successor', trustee, 1, true)
  applyName('trustee_second_successor', trustee, 2)
  applyName('trustee_co_second_successor', trustee, 2, true)

  const executor = getDesignSlots(designSheet, 'executor_slots')
  applyName('pr_primary', executor, 0)
  applyName('pr_co_primary', executor, 0, true)
  applyName('pr_successor', executor, 1)
  applyName('pr_co_successor', executor, 1, true)
  applyName('pr_second_successor', executor, 2)

  const poa = getDesignSlots(designSheet, 'poa_slots')
  applyName('dpoa_primary', poa, 0)
  applyName('dpoa_co_agent', poa, 0, true)
  applyName('dpoa_successor', poa, 1)

  const hcp = getDesignSlots(designSheet, 'hcp_slots')
  applyName('hcp_primary', hcp, 0)
  if (slotAddress(hcp, 0) !== undefined) next.hcp_primary_address = slotAddress(hcp, 0) ?? null
  if (slotRelationship(hcp, 0) !== undefined) next.hcp_primary_relationship = slotRelationship(hcp, 0) ?? null
  applyName('hcp_successor', hcp, 1)
  if (slotAddress(hcp, 1) !== undefined) next.hcp_successor_address = slotAddress(hcp, 1) ?? null
  if (slotRelationship(hcp, 1) !== undefined) next.hcp_successor_relationship = slotRelationship(hcp, 1) ?? null

  const guardian = getDesignSlots(designSheet, 'guardian_slots')
  applyName('guardian_primary', guardian, 0)
  applyName('guardian_successor', guardian, 1)
  applyName('guardian_second_successor', guardian, 2)

  const tempGuardian = getDesignSlots(designSheet, 'temporary_guardian_slots')
  applyName('temp_guardian_primary', tempGuardian, 0)
  applyName('temp_guardian_successor', tempGuardian, 1)
  applyName('temp_guardian_second_successor', tempGuardian, 2)

  const spouseExecutor = getDesignSlots(designSheet, 'spouse_executor_slots')
  applyName('spouse_pr_primary', spouseExecutor, 0)
  applyName('spouse_pr_successor', spouseExecutor, 1)

  const spousePoa = getDesignSlots(designSheet, 'spouse_poa_slots')
  applyName('spouse_dpoa_primary', spousePoa, 0)
  applyName('spouse_dpoa_successor', spousePoa, 1)

  const spouseHcp = getDesignSlots(designSheet, 'spouse_hcp_slots')
  applyName('spouse_hcp_primary', spouseHcp, 0)
  if (slotAddress(spouseHcp, 0) !== undefined) next.spouse_hcp_primary_address = slotAddress(spouseHcp, 0) ?? null
  if (slotRelationship(spouseHcp, 0) !== undefined) next.spouse_hcp_primary_relationship = slotRelationship(spouseHcp, 0) ?? null
  applyName('spouse_hcp_successor', spouseHcp, 1)
  if (slotAddress(spouseHcp, 1) !== undefined) next.spouse_hcp_successor_address = slotAddress(spouseHcp, 1) ?? null
  if (slotRelationship(spouseHcp, 1) !== undefined) next.spouse_hcp_successor_relationship = slotRelationship(spouseHcp, 1) ?? null

  const spouseTrustee = getDesignSlots(designSheet, 'spouse_trustee_slots')
  applyName('spouse_trustee_successor', spouseTrustee, 0)

  return next
}

export function emptyFiduciarySlots(): DraftPayload['fiduciaries'] {
  return {
    pr_primary: null,
    pr_co_primary: null,
    pr_successor: null,
    pr_co_successor: null,
    pr_second_successor: null,
    dpoa_primary: null,
    dpoa_co_agent: null,
    dpoa_successor: null,
    hcp_primary: null,
    hcp_primary_address: null,
    hcp_primary_relationship: null,
    hcp_successor: null,
    hcp_successor_address: null,
    hcp_successor_relationship: null,
    trustee_initial: null,
    trustee_co: null,
    trustee_successor: null,
    trustee_co_successor: null,
    trustee_second_successor: null,
    trustee_co_second_successor: null,
    guardian_primary: null,
    guardian_successor: null,
    guardian_second_successor: null,
    temp_guardian_primary: null,
    temp_guardian_successor: null,
    temp_guardian_second_successor: null,
    spouse_pr_primary: null,
    spouse_pr_successor: null,
    spouse_dpoa_primary: null,
    spouse_dpoa_successor: null,
    spouse_hcp_primary: null,
    spouse_hcp_primary_address: null,
    spouse_hcp_primary_relationship: null,
    spouse_hcp_successor: null,
    spouse_hcp_successor_address: null,
    spouse_hcp_successor_relationship: null,
    spouse_trustee_successor: null,
  }
}

function applyLegacyDesignSheetFiduciaries(
  fiduciaries: DraftPayload['fiduciaries'],
  designSheet: DesignSheetRow | null,
): DraftPayload['fiduciaries'] {
  if (!designSheet) return fiduciaries

  const next = { ...fiduciaries }
  const fill = <K extends keyof DraftPayload['fiduciaries']>(key: K, value: string | null | undefined) => {
    if (!next[key] && value) next[key] = value
  }

  fill('trustee_initial', designSheet.trustee_primary)
  fill('trustee_co', designSheet.trustee_co)
  fill('trustee_successor', designSheet.trustee_alt1)
  fill('trustee_co_successor', designSheet.trustee_alt1_co)
  fill('trustee_second_successor', designSheet.trustee_alt2)

  fill('pr_primary', designSheet.executor_primary)
  fill('pr_co_primary', designSheet.executor_co)
  fill('pr_successor', designSheet.executor_alt1)
  fill('pr_co_successor', designSheet.executor_alt1_co)

  fill('dpoa_primary', designSheet.poa_primary)
  fill('dpoa_co_agent', designSheet.poa_co)
  fill('dpoa_successor', designSheet.poa_alt1)

  fill('hcp_primary', designSheet.hcp_primary)
  fill('hcp_successor', designSheet.hcp_alt1)

  fill('guardian_primary', designSheet.guardian_primary)
  fill('guardian_successor', designSheet.guardian_alt1)

  return next
}

/**
 * Resolve fiduciaries from the design sheet only — slot arrays with optional
 * contact lookup, then legacy string columns. Does not read contact_roles.
 */
export function buildFiduciariesFromDesignSheet(
  designSheet: DesignSheetRow | null,
  contacts: ContactRow[],
  client: { full_name: string; address: string | null },
  spouse: { full_name: string; address: string | null } | null,
): DraftPayload['fiduciaries'] {
  const fromSlots = overlayDesignSheetFiduciarySlots(
    emptyFiduciarySlots(),
    contacts,
    designSheet,
    client,
    spouse,
  )
  return applyLegacyDesignSheetFiduciaries(fromSlots, designSheet)
}

/**
 * Estate-planning practice areas drive draft packages. Missing/blank practice
 * area normalizes to EP (see normalizePracticeArea) so a matter that is already
 * in the design/draft flow still gets trust/will/DPOA/HCP packages — previously
 * a null practice_area made isEP false and preflight only listed parental
 * appointment (ungated) + estate-plan-summary.
 */
export function isEstatePlanningPracticeArea(practiceArea: string | null | undefined): boolean {
  const normalized = normalizePracticeArea(practiceArea)
  return normalized === 'EP' || normalized === 'EP-LP'
}

export function deriveDocuments(
  practiceArea: string | null,
  ancillaryDocs: string[],
  hasMinorChildren: boolean,
  hasYoungAdultChild: boolean,
  isMarried: boolean,
  planType: string | null,
  inclusions: DesignDocumentInclusions,
  trustPlanningType: TrustPlanningType,
  estatePlanSetup?: EstatePlanDesignSetup,
  assetTransferDocs?: ReadonlyArray<'deed' | 'trustees_certificate' | 'real_estate_trust'>,
): DraftPayload['documents'] {
  const isEP = isEstatePlanningPracticeArea(practiceArea)
  const setup = estatePlanSetup ?? {
    trust: inclusions.trust,
    will: inclusions.will,
    power_of_attorney: inclusions.dpoa,
    health_care_proxy: inclusions.healthcare,
    hipaa_authorization: inclusions.healthcare,
    living_will: inclusions.healthcare,
    will_title: inclusions.trust ? 'pour_over_will' as const : 'last_will' as const,
    signing_type: 'undecided' as const,
    ancillary_documents: {
      certificate_of_trust: inclusions.trust,
      assignment_of_personal_property: inclusions.trust,
      funding_instructions: inclusions.trust,
      funding_recommendation: inclusions.trust,
      trust_summary: inclusions.trust,
      estate_plan_summary: true,
      estate_plan_signing_guide: true,
      successor_trustee_checklist: inclusions.trust,
      fiduciary_role_guide: true,
      flowchart: false,
      include_asset_spreadsheet: false,
    },
  }

  const isPourOver = planType === 'pour_over'
  const isOutright = planType === 'outright_will'
  const isTestamentary = planType === 'testamentary_trust'
  const includeTrust = isPourOver && setup.trust  // RLT only ships with pour-over
  const selectedAssetDocs = new Set(assetTransferDocs ?? [])

  return {
    include_trust:                  isEP && includeTrust,
    include_pour_over_will:         isEP && setup.will && isPourOver,
    include_simple_will:            isEP && setup.will && isOutright,
    include_testamentary_trust_will: isEP && setup.will && isTestamentary,
    include_dpoa:                   isEP && setup.power_of_attorney,
    include_hcp:                    isEP && setup.health_care_proxy,
    include_hipaa:                  isEP && setup.hipaa_authorization,
    include_ahd:                    isEP && setup.living_will,
    include_ppm:                    isEP && setup.will,
    include_parental_appointment:   isEP && (hasMinorChildren || ancillaryDocs.includes('parental_appointment')),
    include_temp_delegation:        isEP && hasMinorChildren,
    include_young_adult_estate_plan: isEP && hasYoungAdultChild && inclusions.young_adult_estate_plan,
    include_deed:                   isEP && selectedAssetDocs.has('deed'),
    include_trustees_certificate:   isEP && selectedAssetDocs.has('trustees_certificate'),
    include_real_estate_trust:      isEP && selectedAssetDocs.has('real_estate_trust'),
    spouse_docs:                    isMarried && inclusions.spouse_docs,
    trust_planning_type:            trustPlanningType,
  }
}

/** Resolve asset-transfer doc selections from the design sheet for draft payload / preflight. */
export function selectedAssetTransferDocsFromSheet(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null,
): Array<'deed' | 'trustees_certificate' | 'real_estate_trust'> {
  if (!designSheet) return []
  return getPersistedRealEstateTransfer({ decisions: designSheet.decisions ?? null }).selectedDocs
}

/** Convenience for callers that already have a design-sheet-shaped row. */
export function estatePlanSetupFromSheet(
  designSheet: Parameters<typeof getEstatePlanDesignSetup>[0],
): EstatePlanDesignSetup {
  return getEstatePlanDesignSetup(designSheet)
}