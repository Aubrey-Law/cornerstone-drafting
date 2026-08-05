/** Canonical design-sheet section ids (guided + express + deep links). */
export const DESIGN_SECTION_IDS = {
  intakeReview: 'intake-review',
  clientInformation: 'client-information',
  familyInformation: 'family-information',
  contactsFiduciaries: 'contacts-fiduciaries',
  fiduciaries: 'fiduciaries',
  estatePlanDesign: 'estate-plan-design',
  trustDetails: 'trust-details',
  willDetails: 'will-details',
  financialPoa: 'financial-poa',
  healthcareDirectives: 'healthcare-directives',
  assetSchedules: 'asset-schedules',
  transfersAssignments: 'transfers-assignments',
  attorneyNotes: 'attorney-notes',
} as const

export type DesignSectionId = typeof DESIGN_SECTION_IDS[keyof typeof DESIGN_SECTION_IDS]

export const DESIGN_SHEET_GROUP_IDS = {
  facts: 'facts',
  family: 'family',
  fiduciaries: 'fiduciaries',
  plan: 'plan',
  trust: 'trust',
  powersOfAttorney: 'powers-of-attorney',
  healthcare: 'healthcare',
  realProperty: 'real-property',
  notes: 'notes',
  review: 'review',
} as const

export type DesignSheetGroupId = typeof DESIGN_SHEET_GROUP_IDS[keyof typeof DESIGN_SHEET_GROUP_IDS]

const DESIGN_SHEET_GROUP_ID_SET = new Set<string>(Object.values(DESIGN_SHEET_GROUP_IDS))

/**
 * Resolves a deep-link token (`#hash`, `?section=`) to a design-sheet group.
 * Accepts group ids directly, plus current and legacy section ids.
 */
export function resolveDesignSheetGroupId(token: string | null | undefined): DesignSheetGroupId | null {
  if (!token) return null
  const normalized = normalizeDesignSectionId(token)
  if (normalized && DESIGN_SHEET_GROUP_ID_SET.has(normalized)) return normalized as DesignSheetGroupId
  return designSectionAnchorId(token)
}

const DESIGN_SECTION_GROUPS: Record<DesignSectionId, DesignSheetGroupId> = {
  [DESIGN_SECTION_IDS.intakeReview]: DESIGN_SHEET_GROUP_IDS.facts,
  [DESIGN_SECTION_IDS.clientInformation]: DESIGN_SHEET_GROUP_IDS.facts,
  [DESIGN_SECTION_IDS.familyInformation]: DESIGN_SHEET_GROUP_IDS.facts,
  [DESIGN_SECTION_IDS.assetSchedules]: DESIGN_SHEET_GROUP_IDS.plan,
  [DESIGN_SECTION_IDS.willDetails]: DESIGN_SHEET_GROUP_IDS.family,
  [DESIGN_SECTION_IDS.contactsFiduciaries]: DESIGN_SHEET_GROUP_IDS.fiduciaries,
  [DESIGN_SECTION_IDS.fiduciaries]: DESIGN_SHEET_GROUP_IDS.fiduciaries,
  [DESIGN_SECTION_IDS.estatePlanDesign]: DESIGN_SHEET_GROUP_IDS.plan,
  [DESIGN_SECTION_IDS.trustDetails]: DESIGN_SHEET_GROUP_IDS.trust,
  [DESIGN_SECTION_IDS.financialPoa]: DESIGN_SHEET_GROUP_IDS.powersOfAttorney,
  [DESIGN_SECTION_IDS.healthcareDirectives]: DESIGN_SHEET_GROUP_IDS.healthcare,
  [DESIGN_SECTION_IDS.transfersAssignments]: DESIGN_SHEET_GROUP_IDS.realProperty,
  [DESIGN_SECTION_IDS.attorneyNotes]: DESIGN_SHEET_GROUP_IDS.notes,
}

export function designSectionAnchorId(sectionId: string | null | undefined): DesignSheetGroupId | null {
  const normalized = normalizeDesignSectionId(sectionId)
  if (!normalized) return null
  return DESIGN_SECTION_GROUPS[normalized as DesignSectionId] ?? null
}

/** Map legacy section ids from older URLs / preflight links to current ids. */
export const LEGACY_DESIGN_SECTION_ALIASES: Record<string, DesignSectionId> = {
  'plan-design': DESIGN_SECTION_IDS.estatePlanDesign,
  personal: DESIGN_SECTION_IDS.clientInformation,
  family: DESIGN_SECTION_IDS.familyInformation,
  trust: DESIGN_SECTION_IDS.trustDetails,
  will: DESIGN_SECTION_IDS.willDetails,
  dpoa: DESIGN_SECTION_IDS.financialPoa,
  healthcare: DESIGN_SECTION_IDS.healthcareDirectives,
  assets: DESIGN_SECTION_IDS.assetSchedules,
  'goals-notes': DESIGN_SECTION_IDS.attorneyNotes,
  'dementia-directive': DESIGN_SECTION_IDS.healthcareDirectives,
  deed: DESIGN_SECTION_IDS.transfersAssignments,
  'trust-details-spouse': DESIGN_SECTION_IDS.trustDetails,
}

export function normalizeDesignSectionId(sectionId: string | null | undefined): string | null {
  if (!sectionId) return null
  return LEGACY_DESIGN_SECTION_ALIASES[sectionId] ?? sectionId
}

export function spouseTrustSectionLabel(spouseName: string | null | undefined): string {
  const trimmed = (spouseName ?? '').trim()
  if (!trimmed) return 'Trust Details for Spouse'
  const first = trimmed.split(/\s+/)[0]
  return first ? `Trust Details for ${first}` : 'Trust Details for Spouse'
}
