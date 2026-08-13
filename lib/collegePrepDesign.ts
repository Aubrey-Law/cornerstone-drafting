/**
 * College Preparation Plan — the drafting-side half of the intake track.
 *
 * `lib/collegePrepFields.ts` owns the question vocabulary the client answers;
 * this module owns what the attorney then drafts from. The answers land in
 * `design_sheets.decisions.college_prep` — a JSONB namespace, like
 * `dpoa_provisions` and `healthcare_provisions` — rather than in ~30 new
 * columns, because none of them are queried and all of them are read as a
 * block by the design sheet and the generator.
 *
 * `decisions.plan_track` marks the sheet as a college-prep plan. It is what
 * gates the section list, the document inclusions, and the generator package
 * selection: the student signs a durable power of attorney, health care proxy,
 * HIPAA authorization, and living will, and nothing else. There is no trust, no
 * will, and no deed on this track, so those sections would be dead weight (and
 * their readiness blockers would never clear).
 */

import {
  COLLEGE_DPOA_EFFECTIVE_OPTIONS,
  COLLEGE_DPOA_POWER_OPTIONS,
  COLLEGE_FERPA_RECORD_OPTIONS,
  COLLEGE_HIPAA_EXPIRATION_OPTIONS,
  COLLEGE_HIPAA_SCOPE_OPTIONS,
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
  COLLEGE_LIFE_SUPPORT_OPTIONS,
  COLLEGE_LIVING_WILL_INCLUDE_OPTIONS,
  COLLEGE_ORGAN_DONATION_OPTIONS,
  COLLEGE_TREATMENT_CHOICE_OPTIONS,
  DISCUSS_AT_MEETING,
  namedHipaaRecipients,
  type CollegeHipaaRecipient,
} from '@/lib/collegePrepFields'
import type { DesignSheet } from '@/types/database'

/** Which plan the design sheet drafts. Absent / anything else means estate. */
export type DesignPlanTrack = 'estate' | 'college_prep'

export const DEFAULT_DESIGN_PLAN_TRACK: DesignPlanTrack = 'estate'

type CollegePrepSheet = Pick<DesignSheet, 'decisions'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decisionsOf(sheet: CollegePrepSheet | null | undefined): Record<string, unknown> {
  return isRecord(sheet?.decisions) ? (sheet.decisions as Record<string, unknown>) : {}
}

export function normalizeDesignPlanTrack(value: unknown): DesignPlanTrack | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === 'college_prep' || trimmed === 'estate') return trimmed
  return null
}

export function getDesignPlanTrack(sheet: CollegePrepSheet | null | undefined): DesignPlanTrack {
  return normalizeDesignPlanTrack(decisionsOf(sheet).plan_track) ?? DEFAULT_DESIGN_PLAN_TRACK
}

export function isCollegePrepDesignSheet(sheet: CollegePrepSheet | null | undefined): boolean {
  return getDesignPlanTrack(sheet) === 'college_prep'
}

// ── The drafted answers ──────────────────────────────────────────────────────

export type CollegeDpoaEffective = (typeof COLLEGE_DPOA_EFFECTIVE_OPTIONS)[number]['value']
export type CollegeDpoaPower = (typeof COLLEGE_DPOA_POWER_OPTIONS)[number]['value']
export type CollegeFerpaRecord = (typeof COLLEGE_FERPA_RECORD_OPTIONS)[number]['value']
export type CollegeHipaaScope = (typeof COLLEGE_HIPAA_SCOPE_OPTIONS)[number]['value']
export type CollegeHipaaCategory = (typeof COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS)[number]['value']
export type CollegeHipaaExpiration = (typeof COLLEGE_HIPAA_EXPIRATION_OPTIONS)[number]['value']
export type CollegeLivingWillInclude = (typeof COLLEGE_LIVING_WILL_INCLUDE_OPTIONS)[number]['value']
export type CollegeLifeSupport = (typeof COLLEGE_LIFE_SUPPORT_OPTIONS)[number]['value']
export type CollegeTreatmentChoice = (typeof COLLEGE_TREATMENT_CHOICE_OPTIONS)[number]['value']
export type CollegeOrganDonation = (typeof COLLEGE_ORGAN_DONATION_OPTIONS)[number]['value']

export interface CollegePrepDesign {
  // School and records
  school_name: string | null
  school_city: string | null
  school_state: string | null
  move_in_date: string | null
  studying_abroad: boolean | null
  abroad_country: string | null
  ferpa_release: boolean | null
  ferpa_records: CollegeFerpaRecord[]
  ferpa_recipients: string | null

  // Durable power of attorney
  dpoa_effective: CollegeDpoaEffective | null
  dpoa_powers: CollegeDpoaPower[]
  dpoa_withheld: string | null
  dpoa_notes: string | null

  // Health care proxy
  hcp_limits: string | null
  hcp_instructions: string | null

  // HIPAA authorization
  hipaa_scope: CollegeHipaaScope | null
  hipaa_excluded_categories: CollegeHipaaCategory[]
  hipaa_different_scope: string | null
  hipaa_expiration: CollegeHipaaExpiration | null
  hipaa_expiration_date: string | null
  hipaa_recipients: CollegeHipaaRecipient[]
  excluded_people: string | null

  // Living will
  living_will_include: CollegeLivingWillInclude | null
  life_support: CollegeLifeSupport | null
  cpr: CollegeTreatmentChoice | null
  artificial_nutrition: CollegeTreatmentChoice | null
  ventilation: CollegeTreatmentChoice | null
  comfort_always: boolean | null
  organ_donation: CollegeOrganDonation | null
  organ_donation_notes: string | null
  other_medical_notes: string | null

  // Everything else the student raised
  family_circumstances: string | null
  concerns: string | null
}

export const EMPTY_COLLEGE_PREP_DESIGN: CollegePrepDesign = {
  school_name: null,
  school_city: null,
  school_state: null,
  move_in_date: null,
  studying_abroad: null,
  abroad_country: null,
  ferpa_release: null,
  ferpa_records: [],
  ferpa_recipients: null,
  dpoa_effective: null,
  dpoa_powers: [],
  dpoa_withheld: null,
  dpoa_notes: null,
  hcp_limits: null,
  hcp_instructions: null,
  hipaa_scope: null,
  hipaa_excluded_categories: [],
  hipaa_different_scope: null,
  hipaa_expiration: null,
  hipaa_expiration_date: null,
  hipaa_recipients: [],
  excluded_people: null,
  living_will_include: null,
  life_support: null,
  cpr: null,
  artificial_nutrition: null,
  ventilation: null,
  comfort_always: null,
  organ_donation: null,
  organ_donation_notes: null,
  other_medical_notes: null,
  family_circumstances: null,
  concerns: null,
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readBoolean(raw: Record<string, unknown>, key: string): boolean | null {
  return typeof raw[key] === 'boolean' ? (raw[key] as boolean) : null
}

function readOption<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  options: readonly { value: string }[],
): T | null {
  const value = readString(raw, key)
  if (!value) return null
  return options.some(option => option.value === value) ? (value as T) : null
}

function readOptions<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  options: readonly { value: string }[],
): T[] {
  const value = raw[key]
  if (!Array.isArray(value)) return []
  const allowed = new Set(options.map(option => option.value))
  return value.filter((entry): entry is T => typeof entry === 'string' && allowed.has(entry))
}

/** The college-prep answers as the design sheet and the generator should read them. */
export function getCollegePrepDesign(sheet: CollegePrepSheet | null | undefined): CollegePrepDesign {
  const raw = isRecord(decisionsOf(sheet).college_prep)
    ? (decisionsOf(sheet).college_prep as Record<string, unknown>)
    : {}

  return {
    school_name: readString(raw, 'school_name'),
    school_city: readString(raw, 'school_city'),
    school_state: readString(raw, 'school_state'),
    move_in_date: readString(raw, 'move_in_date'),
    studying_abroad: readBoolean(raw, 'studying_abroad'),
    abroad_country: readString(raw, 'abroad_country'),
    ferpa_release: readBoolean(raw, 'ferpa_release'),
    ferpa_records: readOptions(raw, 'ferpa_records', COLLEGE_FERPA_RECORD_OPTIONS),
    ferpa_recipients: readString(raw, 'ferpa_recipients'),
    dpoa_effective: readOption(raw, 'dpoa_effective', COLLEGE_DPOA_EFFECTIVE_OPTIONS),
    dpoa_powers: readOptions(raw, 'dpoa_powers', COLLEGE_DPOA_POWER_OPTIONS),
    dpoa_withheld: readString(raw, 'dpoa_withheld'),
    dpoa_notes: readString(raw, 'dpoa_notes'),
    hcp_limits: readString(raw, 'hcp_limits'),
    hcp_instructions: readString(raw, 'hcp_instructions'),
    hipaa_scope: readOption(raw, 'hipaa_scope', COLLEGE_HIPAA_SCOPE_OPTIONS),
    hipaa_excluded_categories: readOptions(
      raw,
      'hipaa_excluded_categories',
      COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
    ),
    hipaa_different_scope: readString(raw, 'hipaa_different_scope'),
    hipaa_expiration: readOption(raw, 'hipaa_expiration', COLLEGE_HIPAA_EXPIRATION_OPTIONS),
    hipaa_expiration_date: readString(raw, 'hipaa_expiration_date'),
    hipaa_recipients: namedHipaaRecipients(raw.hipaa_recipients),
    excluded_people: readString(raw, 'excluded_people'),
    living_will_include: readOption(raw, 'living_will_include', COLLEGE_LIVING_WILL_INCLUDE_OPTIONS),
    life_support: readOption(raw, 'life_support', COLLEGE_LIFE_SUPPORT_OPTIONS),
    cpr: readOption(raw, 'cpr', COLLEGE_TREATMENT_CHOICE_OPTIONS),
    artificial_nutrition: readOption(raw, 'artificial_nutrition', COLLEGE_TREATMENT_CHOICE_OPTIONS),
    ventilation: readOption(raw, 'ventilation', COLLEGE_TREATMENT_CHOICE_OPTIONS),
    comfort_always: readBoolean(raw, 'comfort_always'),
    organ_donation: readOption(raw, 'organ_donation', COLLEGE_ORGAN_DONATION_OPTIONS),
    organ_donation_notes: readString(raw, 'organ_donation_notes'),
    other_medical_notes: readString(raw, 'other_medical_notes'),
    family_circumstances: readString(raw, 'family_circumstances'),
    concerns: readString(raw, 'concerns'),
  }
}

/** Merge an attorney edit into `decisions.college_prep` and return the new decisions blob. */
export function setCollegePrepDesign(
  sheet: CollegePrepSheet,
  patch: Partial<CollegePrepDesign>,
): Record<string, unknown> {
  const decisions = decisionsOf(sheet)
  return {
    ...decisions,
    plan_track: 'college_prep',
    college_prep: { ...getCollegePrepDesign(sheet), ...patch },
  }
}

/** Mark a sheet as a college-prep plan without touching anything else. */
export function setDesignPlanTrack(
  sheet: CollegePrepSheet,
  track: DesignPlanTrack,
): Record<string, unknown> {
  return { ...decisionsOf(sheet), plan_track: track }
}

export interface SwitchDesignPlanTrackArgs {
  track: DesignPlanTrack
  /**
   * College-prep answers to adopt with the switch — normally the matter's own
   * questionnaire, when its intake is on that track. Omitted, the section
   * starts empty and the attorney fills it in at the meeting.
   */
  answers?: CollegePrepDesign | null
}

/**
 * Move an already-seeded sheet onto the other plan track.
 *
 * Seeding only runs once, against a blank sheet, so a matter whose intake track
 * was set after drafting opened — or corrected afterwards — is stuck on the
 * wrong track with no way back. This is that way back.
 *
 * The document set has to move with the track. `getDocumentInclusions` overlays
 * explicit attorney toggles on the track's defaults, so a sheet seeded as an
 * estate plan carries `trust: true, will: true` as *stored* values; flipping the
 * marker alone would leave a College Preparation Plan quietly generating a trust
 * and a pour-over will. Clearing the stored inclusions and the estate-plan
 * ancillaries lets the new track's defaults apply.
 *
 * Deliberately preserved: `plan_type` (so flipping back restores the estate
 * structure — it is inert on the college track, where every trust and will
 * inclusion is false), `estate_plan_design.signing_type` and the health care
 * document toggles (both tracks sign documents and both include health care),
 * and any `college_prep` answers already collected.
 */
export function switchDesignPlanTrack(
  sheet: CollegePrepSheet,
  { track, answers }: SwitchDesignPlanTrackArgs,
): Record<string, unknown> {
  const decisions = { ...decisionsOf(sheet) }

  decisions.plan_track = track
  delete decisions.document_inclusions

  const estatePlanDesign = isRecord(decisions.estate_plan_design)
    ? { ...(decisions.estate_plan_design as Record<string, unknown>) }
    : null
  if (estatePlanDesign) {
    delete estatePlanDesign.ancillary_documents
    delete estatePlanDesign.will_title
    decisions.estate_plan_design = estatePlanDesign
  }

  if (track === 'college_prep' && answers) {
    decisions.college_prep = { ...getCollegePrepDesign(sheet), ...answers }
  }

  return decisions
}

// ── Drafting readiness ───────────────────────────────────────────────────────

/**
 * Answers the attorney must resolve before the package can be drafted.
 *
 * "Discuss at the meeting" is a legitimate client answer, not a completed one:
 * the attorney has to replace it with a real choice or the document has nothing
 * to say. The HIPAA expiration is the one item HIPAA itself requires the
 * authorization to state, so it blocks even when everything else is deferred.
 */
export interface CollegePrepBlocker {
  /** Short noun phrase, in the same voice as the estate readiness blockers. */
  label: string
  /** `college_prep.`-prefixed field name the design section anchors. */
  field: string
}

export function collegePrepDraftingBlockers(sheet: CollegePrepSheet): CollegePrepBlocker[] {
  const design = getCollegePrepDesign(sheet)
  const blockers: CollegePrepBlocker[] = []
  const unresolved = (value: string | null) => !value || value === DISCUSS_AT_MEETING

  if (unresolved(design.dpoa_effective)) {
    blockers.push({ label: 'power of attorney effective date', field: 'college_prep.dpoa_effective' })
  } else if (design.dpoa_powers.length === 0) {
    blockers.push({ label: 'powers granted to the financial agent', field: 'college_prep.dpoa_powers' })
  }

  if (unresolved(design.hipaa_scope)) {
    blockers.push({ label: 'HIPAA release scope', field: 'college_prep.hipaa_scope' })
  } else if (design.hipaa_scope === 'all_except' && design.hipaa_excluded_categories.length === 0) {
    blockers.push({
      label: 'HIPAA withheld categories',
      field: 'college_prep.hipaa_excluded_categories',
    })
  }

  if (!design.hipaa_expiration) {
    blockers.push({ label: 'HIPAA expiration', field: 'college_prep.hipaa_expiration' })
  } else if (design.hipaa_expiration === 'date' && !design.hipaa_expiration_date) {
    blockers.push({ label: 'HIPAA expiration date', field: 'college_prep.hipaa_expiration_date' })
  }

  if (unresolved(design.living_will_include)) {
    blockers.push({ label: 'living will decision', field: 'college_prep.living_will_include' })
  } else if (design.living_will_include === 'yes' && unresolved(design.life_support)) {
    blockers.push({
      label: 'life-sustaining treatment instruction',
      field: 'college_prep.life_support',
    })
  }

  return blockers
}

/** True when the living will should be drafted at all. */
export function collegePrepIncludesLivingWill(sheet: CollegePrepSheet): boolean {
  return getCollegePrepDesign(sheet).living_will_include === 'yes'
}
