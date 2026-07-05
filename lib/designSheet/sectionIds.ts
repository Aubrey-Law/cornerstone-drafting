/** Canonical design-sheet section ids (guided + express + deep links). */
export const DESIGN_SECTION_IDS = {
  intakeReview: 'intake-review',
  clientInformation: 'client-information',
  familyInformation: 'family-information',
  fiduciaries: 'fiduciaries',
  estatePlanDesign: 'estate-plan-design',
  trustDetails: 'trust-details',
  trustDetailsSpouse: 'trust-details-spouse',
  willDetails: 'will-details',
  financialPoa: 'financial-poa',
  healthcareDirectives: 'healthcare-directives',
  assetSchedules: 'asset-schedules',
  transfersAssignments: 'transfers-assignments',
  attorneyNotes: 'attorney-notes',
} as const

export type DesignSectionId = typeof DESIGN_SECTION_IDS[keyof typeof DESIGN_SECTION_IDS]

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
