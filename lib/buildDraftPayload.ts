import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import {
  getDocumentInclusions,
  getTrustPlanningType,
  type DesignDocumentInclusions,
  type TrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import { formatPhoneDisplay } from '@/lib/phone'
import type { DesignSheet, DesignSheetChild } from '@/types/database'

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

// ── Exported interface ────────────────────────────────────────────────────────

export interface DraftPayload {
  matter: {
    id: string
    matter_number: string | null
    type: 'individual' | 'married_individual' | 'married_joint'
    trust_type: 'revocable_living' | null
    practice_area: string | null
    minor_children: boolean
  }
  client: {
    first_name: string
    last_name: string
    full_name: string
    aka: string | null
    preferred_pronoun: string | null
    dob: string | null
    address: string | null
    city: string | null
    county: string | null
    state: string | null
    zip: string | null
    email: string | null
    phone: string | null
    excluded_guardian: string | null
  }
  spouse: {
    first_name: string
    last_name: string
    full_name: string
    aka: string | null
    preferred_pronoun: string | null
    dob: string | null
  } | null
  children: Array<{
    full_name: string
    dob: string | null
    relationship: DesignSheetChild['relationship'] | null
    minor: boolean
  }>
  trust: {
    name: string
    date: string
    distribution_ages: number[]
    ma_estate_taxable: boolean
    ma_estate_tax_savings: string | null
    separate_trusts: boolean
    has_ilit: boolean
    ilit_trustee: string | null
  } | null
  fiduciaries: {
    pr_primary: string | null
    pr_co_primary: string | null
    pr_successor: string | null
    pr_co_successor: string | null
    pr_second_successor: string | null
    dpoa_primary: string | null
    dpoa_co_agent: string | null
    dpoa_successor: string | null
    hcp_primary: string | null
    hcp_primary_address: string | null
    hcp_primary_relationship: string | null
    hcp_successor: string | null
    hcp_successor_address: string | null
    hcp_successor_relationship: string | null
    trustee_initial: string | null
    trustee_co: string | null
    trustee_successor: string | null
    trustee_co_successor: string | null
    trustee_second_successor: string | null
    trustee_co_second_successor: string | null
    guardian_primary: string | null
    guardian_successor: string | null
    guardian_second_successor: string | null
    temp_guardian_primary: string | null
    temp_guardian_successor: string | null
    temp_guardian_second_successor: string | null
    spouse_pr_primary: string | null
    spouse_pr_successor: string | null
    spouse_dpoa_primary: string | null
    spouse_dpoa_successor: string | null
    spouse_hcp_primary: string | null
    spouse_hcp_primary_address: string | null
    spouse_hcp_primary_relationship: string | null
    spouse_hcp_successor: string | null
    spouse_hcp_successor_address: string | null
    spouse_hcp_successor_relationship: string | null
    spouse_trustee_successor: string | null
  }
  documents: {
    include_trust: boolean
    include_pour_over_will: boolean
    include_simple_will: boolean
    include_testamentary_trust_will: boolean
    include_dpoa: boolean
    include_hcp: boolean
    include_hipaa: boolean
    include_ahd: boolean
    include_ppm: boolean
    include_parental_appointment: boolean
    include_temp_delegation: boolean
    include_young_adult_estate_plan?: boolean
    spouse_docs: boolean
    /** Individual-trust structure; `disclaimer` selects the married-individual disclaimer trust. */
    trust_planning_type: TrustPlanningType
  }
  will_provisions: {
    pr_structure: 'single' | 'spouse_first' | 'co_pr' | null
    trustee_structure: 'single' | 'spouse_first' | 'co_trustees' | null
    cotrustee_decision_standard: 'majority' | 'unanimous' | null
    bond: 'no_bond' | 'required'
    supervision: 'unsupervised' | 'supervised'
    simultaneous_death: 'spouse_survives' | 'testator_survives' | 'omit' | null
    utma_age: 18 | 21
    no_contest_clause: 'omit' | 'include'
    include_disclaimer_article: boolean
    include_self_proving_affidavit: boolean
    tangible_property_distribution: string | null
    tangible_property_named_individual: string | null
    pour_over_alternate_disposition: string | null
    pour_over_alternate_named: string | null
    outright_residuary: string | null
    outright_residuary_named: string | null
    outright_residuary_alternate: string | null
    beneficiary_structure: string | null
    single_beneficiary_name: string | null
    single_beneficiary_remainder: string | null
    age_distribution_schedule: string | null
    trust_protector: boolean
    trust_protector_name: string | null
    pet_care_option: 'omit' | 'direct_bequest' | 'pet_trust'
    pet_care_details: Record<string, unknown>
    specific_bequests: unknown[]
  }
  dpoa_provisions: {
    coagent_manner: 'independently' | 'jointly' | 'majority'
    self_dealing_reviewer: string | null
    self_dealing_reviewer_alt: string | null
    include_section_l: boolean
  }
  hcp_provisions: {
    anatomical_gift: 'all' | 'specified' | 'none' | null
    anatomical_specified: string | null
  }
  hipaa_provisions: {
    psychotherapy_notes: 'authorize' | 'do_not_authorize' | null
  }
  execution: {
    signing_month: string | null
    signing_year: string | null
    signing_county: string | null
    notary_commission_expiration: string | null
  }
  design_sheet_id: string | null
  special_provisions: string | null
  ancillary_docs: string[]
  notes: string | null
}

// ── Row shapes returned from Supabase ─────────────────────────────────────────

interface MatterRow {
  id: string
  client_intake_id: string
  matter_number: string | null
  status: string | null
  stage: string | null
}

interface MatterDetailsRow {
  id: string
  client_id: string
  practice_area: string | null
  ep_trust_type: string | null
  ep_ancillary_docs: unknown
  ep_special_provisions: string | null
  ep_ma_estate_taxable: boolean | null
  ep_ma_estate_tax_savings: number | null
  ep_separate_trusts: boolean | null
  ep_has_ilit: boolean | null
  ep_ilit_trustee: string | null
  internal_notes: string | null
}

interface ClientIntakeRow {
  id: string
  matter_id: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  full_name: string | null
  preferred_pronoun: string | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  city: string | null
  county: string | null
  state: string | null
  zip: string | null
  marital_status: string | null
  has_minor_children: boolean | null
  practice_area: string | null
}

interface ContactRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_pronoun: string | null
  relationship_type: string | null
  relationship_label: string | null
  address_line1: string | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  contact_roles: ContactRoleRow[]
}

interface ContactRoleRow {
  id: string
  contact_id: string
  client_intake_id: string
  role: string
  for_party: string
  priority: number
  is_coagent: boolean
}

interface DesignSheetRow {
  id: string
  client_intake_id?: string | null
  status: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  plan_type?: string | null
  is_joint?: boolean | null
  trust_name?: string | null
  trust_date?: string | null
  client_aka?: string | null
  spouse_aka?: string | null
  county?: string | null
  excluded_guardian_flag?: boolean | null
  excluded_guardian_name?: string | null
  children?: DesignSheetChild[] | null
  // Will-common selections
  pr_structure?: string | null
  bond?: string | null
  supervision?: string | null
  simultaneous_death?: string | null
  utma_age?: number | null
  no_contest_clause?: string | null
  include_disclaimer_article?: boolean | null
  include_self_proving_affidavit?: boolean | null
  tangible_property_distribution?: string | null
  tangible_property_named_individual?: string | null
  // Pet care + bequests
  pet_care_option?: string | null
  pet_care_details?: Record<string, unknown> | null
  specific_bequests?: unknown[] | null
  // DPOA / HCP / HIPAA
  dpoa_coagent_manner?: string | null
  dpoa_self_dealing_reviewer?: string | null
  dpoa_self_dealing_reviewer_alt?: string | null
  dpoa_include_section_l?: string | null
  hcp_anatomical_gift?: string | null
  hcp_anatomical_specified?: string | null
  hipaa_psychotherapy_notes?: string | null
  // Pour-Over
  pour_over_alternate_disposition?: string | null
  pour_over_alternate_named?: string | null
  // Outright
  outright_residuary?: string | null
  outright_residuary_named?: string | null
  outright_residuary_alternate?: string | null
  // Testamentary trust
  trustee_structure?: string | null
  cotrustee_decision_standard?: string | null
  beneficiary_structure?: string | null
  single_beneficiary_name?: string | null
  single_beneficiary_remainder?: string | null
  age_distribution_schedule?: string | null
  trust_protector?: boolean | null
  trust_protector_name?: string | null
  // Execution mechanics
  signing_month?: string | null
  signing_year?: string | null
  signing_county?: string | null
  notary_commission_expiration?: string | null
  trustee_slots?: FiduciarySlotRow[] | null
  executor_slots?: FiduciarySlotRow[] | null
  poa_slots?: FiduciarySlotRow[] | null
  hcp_slots?: FiduciarySlotRow[] | null
  guardian_slots?: FiduciarySlotRow[] | null
  temporary_guardian_slots?: FiduciarySlotRow[] | null
  spouse_trustee_slots?: FiduciarySlotRow[] | null
  spouse_executor_slots?: FiduciarySlotRow[] | null
  spouse_poa_slots?: FiduciarySlotRow[] | null
  spouse_hcp_slots?: FiduciarySlotRow[] | null
  decisions?: Record<string, unknown> | null
}

interface FiduciarySlotRow {
  id: string
  contact_id: string | null
  is_co: boolean
  order: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ')
}

/** Pick the first non-null, non-empty value from an array of candidates. */
function pick(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v != null && v !== '') return v
  }
  return null
}

function decisionString(
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

function designSheetForDocumentInclusions(designSheet: DesignSheetRow | null, maritalStatus: string | null) {
  return {
    plan_type: designSheet?.plan_type ?? null,
    marital_status: maritalStatus,
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
function buildFiduciarySlots(contacts: ContactRow[]): DraftPayload['fiduciaries'] {
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

function overlayDesignSheetFiduciarySlots(
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

function deriveDocuments(
  practiceArea: string | null,
  ancillaryDocs: string[],
  hasMinorChildren: boolean,
  hasYoungAdultChild: boolean,
  isMarried: boolean,
  planType: string | null,
  inclusions: DesignDocumentInclusions,
  trustPlanningType: TrustPlanningType,
): DraftPayload['documents'] {
  const isEP = practiceArea != null &&
    (practiceArea.toUpperCase().includes('EP') || practiceArea.toLowerCase().includes('estate'))

  const isPourOver = planType === 'pour_over'
  const isOutright = planType === 'outright_will'
  const isTestamentary = planType === 'testamentary_trust'
  const includeTrust = isPourOver && inclusions.trust  // RLT only ships with pour-over

  return {
    include_trust:                  isEP && includeTrust,
    include_pour_over_will:         isEP && inclusions.will && isPourOver,
    include_simple_will:            isEP && inclusions.will && isOutright,
    include_testamentary_trust_will: isEP && inclusions.will && isTestamentary,
    include_dpoa:                   isEP && inclusions.dpoa,
    include_hcp:                    isEP && inclusions.healthcare,
    include_hipaa:                  isEP && inclusions.healthcare,
    include_ahd:                    isEP && inclusions.healthcare,
    include_ppm:                    isEP && inclusions.will,
    include_parental_appointment:   hasMinorChildren || ancillaryDocs.includes('parental_appointment'),
    include_temp_delegation:        hasMinorChildren,
    include_young_adult_estate_plan: isEP && hasYoungAdultChild && inclusions.young_adult_estate_plan,
    spouse_docs:                    isMarried && inclusions.spouse_docs,
    trust_planning_type:            trustPlanningType,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildDraftPayload(matterId: string): Promise<DraftPayload> {
  const admin = getAdminClient()
  const resolvedMatterId = await resolveMatterId(matterId, admin)

  // ── Parallel fetches ────────────────────────────────────────────────────────

  const [
    { data: matterRaw, error: matterError },
    { data: detailsRaw },
    { data: designSheetRaw },
  ] = await Promise.all([
    admin
      .from('matters')
      .select('id, client_intake_id, matter_number, status, stage')
      .eq('id', resolvedMatterId)
      .maybeSingle(),

    admin
      .from('matter_details')
      .select(
        'id, client_id, practice_area, ep_trust_type, ep_ancillary_docs, ' +
        'ep_special_provisions, ep_ma_estate_taxable, ep_ma_estate_tax_savings, ' +
        'ep_separate_trusts, ep_has_ilit, ep_ilit_trustee, internal_notes'
      )
      .eq('client_id', resolvedMatterId)
      .maybeSingle(),

    admin
      .from('design_sheets')
      .select('*')
      .eq('matter_id', resolvedMatterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // ── Validate required rows ──────────────────────────────────────────────────

  if (matterError || !matterRaw) {
    throw new Error('Matter not found: ' + matterId)
  }

  const matter = matterRaw as MatterRow
  // Overlay computed defaults (trust name, citizenship, domicile) onto the saved
  // sheet before any reads. The drafting workspace persists these on load, but
  // generation can be triggered without that page (e.g. a direct API call), and
  // applying them here also makes the trust name consistent with the seeded
  // default instead of the divergent fallback further down. Side-effect-free:
  // computeDesignSheetDefaults only fills blanks, so attorney values win.
  const rawDesignSheet = designSheetRaw as DesignSheetRow | null
  const designSheet: DesignSheetRow | null = rawDesignSheet
    ? ({
        ...rawDesignSheet,
        ...computeDesignSheetDefaults(rawDesignSheet as unknown as DesignSheet, {
          client_name: '',
          spouse_name: '',
        }),
      } as DesignSheetRow)
    : null
  const details = detailsRaw as MatterDetailsRow | null

  if (!matter.client_intake_id) {
    throw new Error('No intake found for matter: ' + resolvedMatterId)
  }

  const [{ data: intakeRaw }, { data: contactsRaw }] = await Promise.all([
    admin
      .from('client_intake')
      .select(
        'id, first_name, middle_name, last_name, full_name, date_of_birth, ' +
        'preferred_pronoun, ' +
        'phone, email, address_line1, city, county, state, zip, marital_status, has_minor_children, ' +
        'practice_area'
      )
      .eq('id', matter.client_intake_id)
      .maybeSingle(),
    admin
      .from('contacts')
      .select('id, first_name, middle_name, last_name, preferred_pronoun, relationship_type, relationship_label, address_line1, date_of_birth, phone, email, contact_roles(*)')
      .eq('client_intake_id', matter.client_intake_id),
  ])

  if (!intakeRaw) {
    throw new Error('No intake found for matter: ' + resolvedMatterId)
  }

  const intake = intakeRaw as unknown as ClientIntakeRow
  const contacts = (contactsRaw ?? []) as unknown as ContactRow[]

  const normalizedPlanType = normalizeDesignPlanType(designSheet?.plan_type)
  const isJoint = designSheet?.is_joint === true

  // ── Derive shared values ────────────────────────────────────────────────────

  const isMarried = intake.marital_status?.toLowerCase() === 'married'
  const designChildren = draftPayloadChildren(designSheet)
  const hasMinorChildren = designChildren.some(child => child.minor) || (intake.has_minor_children ?? false)
  const hasYoungAdultChild = hasYoungAdultEstatePlanChild(designSheet?.children)
  const documentInclusions = getDocumentInclusions(designSheetForDocumentInclusions(designSheet, intake.marital_status))
  const trustPlanningType = getTrustPlanningType({ decisions: designSheet?.decisions ?? null })

  // matter.type — joint vs individual is now driven by design_sheets.is_joint, not plan_type
  let matterType: DraftPayload['matter']['type']
  if (!isMarried) {
    matterType = 'individual'
  } else if (isJoint) {
    matterType = 'married_joint'
  } else {
    matterType = 'married_individual'
  }

  // trust_type
  const effectivePracticeArea = pick(details?.practice_area, intake.practice_area)
  const isEP = effectivePracticeArea != null &&
    (effectivePracticeArea.toUpperCase().includes('EP') ||
     effectivePracticeArea.toLowerCase().includes('estate'))

  const trustType: DraftPayload['matter']['trust_type'] = isEP
    ? ((details?.ep_trust_type as 'revocable_living' | null) ?? 'revocable_living')
    : null

  // ancillary docs
  const rawAncillary = details?.ep_ancillary_docs
  const ancillaryDocs: string[] = Array.isArray(rawAncillary) ? (rawAncillary as string[]) : []

  // Whether the plan uses revocable trust metadata. This is broader than
  // generating the trust document because a pour-over will still needs the
  // trust name/date when the trust draft itself is unchecked.
  const usesRevocableTrust = normalizedPlanType
    ? normalizedPlanType === 'pour_over'
    : trustType != null

  // ── Client ─────────────────────────────────────────────────────────────────

  const clientFirst = intake.first_name ?? ''
  const clientLast = intake.last_name ?? ''
  const clientFullName = pick(intake.full_name, fullName(clientFirst, clientLast)) ?? ''
  // Manual design-sheet edits persist these address fields into `decisions`
  // (only the intake sync worker writes the real columns), so fall back to
  // decisions — as `county` already does — when the column is empty.
  const clientAddress = pick(designSheet?.street, decisionString(designSheet, 'street'), intake.address_line1)
  const clientCity = pick(designSheet?.city, decisionString(designSheet, 'city'), intake.city)
  const clientCounty = pick(
    designSheet?.county,
    decisionString(designSheet, 'county'),
    intake.county,
    designSheet?.signing_county,
  )
  const clientState = pick(designSheet?.state, decisionString(designSheet, 'state'), intake.state)
  const clientZip = pick(designSheet?.zip, decisionString(designSheet, 'zip'), intake.zip)

  // ── Spouse ─────────────────────────────────────────────────────────────────

  const spouseContact = contacts.find(c => c.relationship_type === 'spouse') ?? null
  const spouseFirst = spouseContact?.first_name ?? ''
  const spouseLast = spouseContact?.last_name ?? ''
  const spouseFullName = pick(
    [spouseFirst, spouseContact?.middle_name, spouseLast].filter(Boolean).join(' ') || null,
    fullName(spouseFirst, spouseLast),
  )

  const spouse: DraftPayload['spouse'] = isMarried && spouseFullName
    ? {
        first_name: spouseFirst,
        last_name: spouseLast,
        full_name: spouseFullName,
        aka: designSheet?.spouse_aka ?? null,
        preferred_pronoun: spouseContact?.preferred_pronoun ?? null,
        dob: spouseContact?.date_of_birth ?? null,
      }
    : null

  // ── Trust ──────────────────────────────────────────────────────────────────

  let trustName: string
  if (designSheet?.trust_name) {
    trustName = designSheet.trust_name
  } else if (matterType === 'married_joint') {
    trustName = `${clientLast} Family Revocable Living Trust`
  } else {
    trustName = `${clientFullName} Revocable Living Trust`
  }

  // Distribution ages from age_distribution_schedule (Testamentary Trust §5.5)
  function deriveDistributionAges(schedule: string | null | undefined): number[] {
    switch (schedule) {
      case 'outright_25': return [25]
      case 'outright_30': return [30]
      case 'outright_35': return [35]
      case 'staggered_25_30_35': return [25, 30, 35]
      default: return [25, 30, 35]
    }
  }

  const trust: DraftPayload['trust'] = usesRevocableTrust
    ? {
        name: trustName,
        date: designSheet?.trust_date || new Date().toISOString().split('T')[0],
        distribution_ages: deriveDistributionAges(designSheet?.age_distribution_schedule),
        ma_estate_taxable: details?.ep_ma_estate_taxable ?? false,
        ma_estate_tax_savings: details?.ep_ma_estate_tax_savings != null
          ? String(details.ep_ma_estate_tax_savings)
          : null,
        separate_trusts: details?.ep_separate_trusts ?? false,
        has_ilit: details?.ep_has_ilit ?? false,
        ilit_trustee: details?.ep_ilit_trustee ?? null,
      }
    : null

  // ── Fiduciaries ────────────────────────────────────────────────────────────

  const fiduciaries = overlayDesignSheetFiduciarySlots(
    buildFiduciarySlots(contacts),
    contacts,
    designSheet,
    {
      full_name: clientFullName,
      address: clientAddress,
    },
    spouse ? {
      full_name: spouse.full_name,
      address: null,
    } : null,
  )

  // ── Documents ─────────────────────────────────────────────────────────────

  const documents = deriveDocuments(
    effectivePracticeArea,
    ancillaryDocs,
    hasMinorChildren,
    hasYoungAdultChild,
    isMarried,
    normalizedPlanType,
    documentInclusions,
    trustPlanningType,
  )

  // ── Will / DPOA / HCP / HIPAA provisions ──────────────────────────────────

  const will_provisions: DraftPayload['will_provisions'] = {
    pr_structure: (designSheet?.pr_structure as DraftPayload['will_provisions']['pr_structure']) ?? null,
    trustee_structure: (designSheet?.trustee_structure as DraftPayload['will_provisions']['trustee_structure']) ?? null,
    cotrustee_decision_standard: (designSheet?.cotrustee_decision_standard as DraftPayload['will_provisions']['cotrustee_decision_standard']) ?? null,
    bond: (designSheet?.bond as 'no_bond' | 'required') ?? 'no_bond',
    supervision: (designSheet?.supervision as 'unsupervised' | 'supervised') ?? 'unsupervised',
    simultaneous_death: (designSheet?.simultaneous_death as DraftPayload['will_provisions']['simultaneous_death']) ?? null,
    utma_age: ((designSheet?.utma_age === 18 ? 18 : 21) as 18 | 21),
    no_contest_clause: (designSheet?.no_contest_clause as 'omit' | 'include') ?? 'omit',
    include_disclaimer_article: designSheet?.include_disclaimer_article ?? true,
    include_self_proving_affidavit: designSheet?.include_self_proving_affidavit ?? true,
    tangible_property_distribution: designSheet?.tangible_property_distribution ?? null,
    tangible_property_named_individual: designSheet?.tangible_property_named_individual ?? null,
    pour_over_alternate_disposition: designSheet?.pour_over_alternate_disposition ?? null,
    pour_over_alternate_named: designSheet?.pour_over_alternate_named ?? null,
    outright_residuary: designSheet?.outright_residuary ?? null,
    outright_residuary_named: designSheet?.outright_residuary_named ?? null,
    outright_residuary_alternate: designSheet?.outright_residuary_alternate ?? null,
    beneficiary_structure: designSheet?.beneficiary_structure ?? null,
    single_beneficiary_name: designSheet?.single_beneficiary_name ?? null,
    single_beneficiary_remainder: designSheet?.single_beneficiary_remainder ?? null,
    age_distribution_schedule: designSheet?.age_distribution_schedule ?? null,
    trust_protector: designSheet?.trust_protector ?? false,
    trust_protector_name: designSheet?.trust_protector_name ?? null,
    pet_care_option: (designSheet?.pet_care_option as 'omit' | 'direct_bequest' | 'pet_trust') ?? 'omit',
    pet_care_details: designSheet?.pet_care_details ?? {},
    specific_bequests: designSheet?.specific_bequests ?? [],
  }

  const dpoa_provisions: DraftPayload['dpoa_provisions'] = {
    coagent_manner: (designSheet?.dpoa_coagent_manner as DraftPayload['dpoa_provisions']['coagent_manner']) ?? 'independently',
    self_dealing_reviewer: designSheet?.dpoa_self_dealing_reviewer ?? null,
    self_dealing_reviewer_alt: designSheet?.dpoa_self_dealing_reviewer_alt ?? null,
    include_section_l: designSheet?.dpoa_include_section_l === 'yes',
  }

  const hcp_provisions: DraftPayload['hcp_provisions'] = {
    anatomical_gift: (designSheet?.hcp_anatomical_gift as DraftPayload['hcp_provisions']['anatomical_gift']) ?? null,
    anatomical_specified: designSheet?.hcp_anatomical_specified ?? null,
  }

  const hipaa_provisions: DraftPayload['hipaa_provisions'] = {
    psychotherapy_notes: (designSheet?.hipaa_psychotherapy_notes as DraftPayload['hipaa_provisions']['psychotherapy_notes']) ?? null,
  }

  const execution: DraftPayload['execution'] = {
    signing_month: designSheet?.signing_month ?? null,
    signing_year: designSheet?.signing_year ?? null,
    signing_county: designSheet?.signing_county ?? null,
    notary_commission_expiration: designSheet?.notary_commission_expiration ?? null,
  }

  // ── Assemble payload ───────────────────────────────────────────────────────

  return {
    matter: {
      id: matter.id,
      matter_number: matter.matter_number,
      type: matterType,
      trust_type: trustType,
      practice_area: effectivePracticeArea,
      minor_children: hasMinorChildren,
    },
    client: {
      first_name: clientFirst,
      last_name: clientLast,
      full_name: clientFullName,
      aka: designSheet?.client_aka ?? null,
      preferred_pronoun: intake.preferred_pronoun ?? null,
      dob: intake.date_of_birth ?? null,
      address: clientAddress,
      city: clientCity,
      county: clientCounty,
      state: clientState,
      zip: clientZip,
      email: intake.email ?? null,
      phone: formatPhoneDisplay(intake.phone) || null,
      excluded_guardian: designSheet?.excluded_guardian_flag
        ? (designSheet.excluded_guardian_name ?? null)
        : null,
    },
    spouse,
    children: draftPayloadChildren(designSheet),
    trust,
    fiduciaries,
    documents,
    will_provisions,
    dpoa_provisions,
    hcp_provisions,
    hipaa_provisions,
    execution,
    design_sheet_id: designSheet?.id ?? null,
    special_provisions: details?.ep_special_provisions ?? null,
    ancillary_docs: ancillaryDocs,
    notes: details?.internal_notes ?? null,
  }
}

export async function resolveMatterId(inputId: string, admin = getAdminClient()): Promise<string> {
  const { data: matter } = await admin
    .from('matters')
    .select('id')
    .eq('id', inputId)
    .maybeSingle()

  if (matter?.id) return matter.id

  const { data: sheet } = await admin
    .from('design_sheets')
    .select('matter_id')
    .eq('id', inputId)
    .maybeSingle()

  if (sheet?.matter_id) return sheet.matter_id as string

  const { data: legacySheet } = await admin
    .from('design_sheets')
    .select('client_intake_id')
    .eq('matter_id', inputId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (legacySheet?.client_intake_id) {
    const { data: canonicalMatter } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', legacySheet.client_intake_id)
      .maybeSingle()

    if (canonicalMatter?.id) return canonicalMatter.id
  }

  const { data: intakeMatter } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', inputId)
    .maybeSingle()

  if (intakeMatter?.id) return intakeMatter.id

  const { data: legacyIntake } = await admin
    .from('client_intake')
    .select('id')
    .eq('matter_id', inputId)
    .maybeSingle()

  if (legacyIntake?.id) {
    const { data: matterFromLegacyIntake } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', legacyIntake.id)
      .maybeSingle()

    if (matterFromLegacyIntake?.id) return matterFromLegacyIntake.id
  }

  return inputId
}
