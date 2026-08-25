import type { DesignSheetChild } from '@/types/database'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { formatPhoneDisplay } from '@/lib/phone'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { isYoungAdultEstatePlanAge } from '@/lib/youngAdultEstatePlan'
import {
  childGenderDisplay,
  draftPayloadBlendedFamily,
  draftPayloadFamilyProvisions,
  hasBlendedFamily,
  type DraftPayloadFamilyProvisions,
} from '@/lib/draftPayload/familyProvisions'
import {
  defaultDraftPayloadTrustProvisions,
  descendantsDistributionMethod,
  trustCoTrusteesAction,
} from '@/lib/draftPayload/trustProvisions'
import { draftPayloadHasRealProperty } from '@/lib/draftPayload/assets'
import { assetCategoryLabel } from '@/lib/draftPayload/fundingPlan'
import {
  generatorPersonFromContactDetail,
  getDraftPayloadFiduciaryDisplay,
} from '@/lib/draftPayload/fiduciaryDetails'
import type { DraftPayloadContactDetail } from '@/lib/draftPayload/fiduciaryDetails'

export type EstateGeneratorPackage =
  | 'core-estate'
  | 'estate-plan-summary'
  | 'incapacity-documents'
  | 'indv-disclaimer-trust'
  | 'joint-trust'
  | 'joint-trust-simplified'
  | 'parental-guardian-appointment'
  | 'temporary-delegation-parental-powers'
  | 'personal-property-memorandum'
  | 'pourover-will'
  | 'simple-will'
  | 'spouse-incapacity-documents'
  | 'spouse-pourover-will'
  | 'spouse-testamentary-trust-will'
  | 'testamentary-trust-will'
  | 'trust-individual-single'
  | 'certificate-of-trust'
  | 'assignment-of-personal-property'
  | 'funding-instructions'
  | 'trust-funding-plan'
  | 'homestead-trustee'
  | 'young-adult-estate-plan'
  | 'ferpa-release'
  | 'will-cp'
  | 'college-financial-poa'
  | 'college-education-poa'
  | 'college-health-care-documents'
  | 'college-advance-directive'

export interface EstateGeneratorData {
  client: Record<string, unknown>
  spouse?: Record<string, unknown>
  marriage?: Record<string, unknown>
  children: Array<Record<string, unknown>>
  summary: Record<string, unknown>
  planning: Record<string, unknown>
  will: Record<string, unknown>
  trust: Record<string, unknown>
  pour_over: Record<string, unknown>
  outright_will: Record<string, unknown>
  dpoa: Record<string, unknown>
  testamentary_trust: Record<string, unknown>
  fiduciaries: Record<string, unknown>
  fiduciary_display: Record<string, unknown>
  healthcare: Record<string, unknown>
  hipaa: Record<string, unknown>
  ferpa: Record<string, unknown>
  will_cp: Record<string, unknown>
  college: Record<string, unknown>
  execution: Record<string, unknown>
  specific_gifts: unknown[]
  charitable_gifts: unknown[]
  guardians: Record<string, unknown>
  family: Record<string, unknown>
  assets: Record<string, unknown>
  funding_plan: Record<string, unknown>
  homestead: Record<string, unknown>
  tax: Record<string, unknown>
  /** Attorney-defined template variables, referenced in templates as `extras.*`. */
  extras: Record<string, string>
  drafting_notes?: string
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
}

function person(fullName?: string | null, extra: Record<string, unknown> = {}) {
  return {
    full_name: firstText(fullName) ?? '',
    ...extra,
  }
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as T
}

type PronounSet = {
  subject: string
  object: string
  possessive: string
}

function pronounsFromPreference(value: string | null | undefined): PronounSet {
  const normalized = value?.trim().toLowerCase() ?? ''

  if (normalized.startsWith('he')) {
    return { subject: 'he', object: 'him', possessive: 'his' }
  }

  if (normalized.startsWith('she')) {
    return { subject: 'she', object: 'her', possessive: 'her' }
  }

  if (normalized.startsWith('ze')) {
    return { subject: 'ze', object: 'zir', possessive: 'zir' }
  }

  return { subject: 'they', object: 'them', possessive: 'their' }
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? firstText(value) : undefined
}

function formatMoney(value: unknown): string {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN

  if (!Number.isFinite(amount)) return '$________'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function normalizeSpecificBequests(raw: unknown[]): {
  specificGifts: Array<Record<string, unknown>>
  charitableGifts: Array<Record<string, unknown>>
} {
  const specificGifts: Array<Record<string, unknown>> = []
  const charitableGifts: Array<Record<string, unknown>> = []

  for (const value of raw) {
    const bequest = recordValue(value)
    const kind = bequest.kind
    let item: string | undefined
    let recipient: string | undefined

    if (kind === 'cash') {
      item = `the sum of ${formatMoney(bequest.amount)}`
      recipient = textValue(bequest.beneficiary_name)
    } else if (kind === 'item') {
      item = textValue(bequest.item_description)
      recipient = textValue(bequest.beneficiary_name)
    } else if (kind === 'charitable') {
      item = `the sum of ${formatMoney(bequest.amount)}`
      recipient = textValue(bequest.charity_name)
    } else {
      item = textValue(bequest.item)
      recipient = textValue(bequest.recipient)
    }

    if (!item || !recipient) continue

    // Carry the instrument routing so per-package data can keep a gift the
    // attorney assigned to the will out of the trust (and vice versa).
    const documentRoute = bequest.document === 'will' || bequest.document === 'trust'
      ? bequest.document
      : undefined
    const timing = textValue(bequest.timing)
    const gift = compactObject({
      item,
      recipient,
      document: documentRoute,
      timing: timing || undefined,
      // Field names the design-summary templates loop over; without them every
      // gift row in the client-facing summary rendered blank.
      beneficiary_name: recipient,
      description: item,
      trigger: timing || undefined,
      notes: textValue(bequest.notes) || undefined,
    })
    specificGifts.push(gift)
    if (kind === 'charitable') charitableGifts.push(gift)
  }

  return { specificGifts, charitableGifts }
}

function petCareProvision(payload: DraftPayload) {
  const option = payload.will_provisions.pet_care_option ?? 'omit'
  const details = recordValue(payload.will_provisions.pet_care_details)

  return compactObject({
    option,
    document: details.document === 'will' || details.document === 'trust' ? details.document : undefined,
    cash_amount: option === 'omit' ? undefined : formatMoney(details.cash_amount),
    primary_caretaker: person(textValue(details.primary_caretaker)),
    successor_caretaker: person(textValue(details.successor_caretaker)),
    pet_trustee: person(textValue(details.pet_trustee)),
    remainder_beneficiary: person(textValue(details.remainder_beneficiary)),
    enforcer: person(textValue(details.enforcer)),
  })
}

function parseDate(value: string): Date | null {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  const parsed = new Date(isoDate)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatLongDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = parseDate(value)
  if (!parsed) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function ordinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function formatOrdinalDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = parseDate(value)
  if (!parsed) return undefined
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(parsed)
  const day = parsed.getUTCDate()
  const year = parsed.getUTCFullYear()
  return `the ${ordinalDay(day)} day of ${month}, ${year}`
}

function documentName(value: string): string {
  return value.toUpperCase()
}

function pourOverAlternateDispositionText(payload: DraftPayload): string {
  const disposition = payload.will_provisions.pour_over_alternate_disposition
  const namedBeneficiary = firstText(payload.will_provisions.pour_over_alternate_named)
  const prefix = 'If incorporation by reference fails for any reason, I direct my Personal Representative to distribute the remainder of my estate, excluding any property over which I have a power of appointment,'

  if (disposition === 'descendants_only') {
    return `${prefix} to my descendants, per stirpes.`
  }

  if (disposition === 'named' && namedBeneficiary) {
    return `${prefix} to ${documentName(namedBeneficiary)}.`
  }

  return `${prefix} to my spouse if my spouse survives me. If my spouse does not survive me I direct my Personal Representative to distribute the property to my descendants, per stirpes.`
}

function outrightResiduaryDisposition(payload: DraftPayload): string {
  const disposition = payload.will_provisions.outright_residuary

  if (
    disposition === 'spouse_then_descendants' ||
    disposition === 'descendants_then_heirs' ||
    disposition === 'named'
  ) {
    return disposition
  }

  return payload.spouse ? 'spouse_then_descendants' : 'descendants_then_heirs'
}

function poaCoAgentsAction(value: DraftPayload['dpoa_provisions']['coagent_manner']): string {
  if (value === 'jointly') return 'joint'
  if (value === 'majority') return 'majority'
  return 'separate'
}

function testamentaryCoTrustee(payload: DraftPayload) {
  const structure = payload.will_provisions.trustee_structure
  if (structure && structure !== 'co_trustees') return person(null)
  return person(payload.fiduciaries.trustee_co)
}

function spouseTestamentaryCoTrustee(payload: DraftPayload) {
  const structure = payload.will_provisions.trustee_structure
  if (structure && structure !== 'co_trustees') return person(null)
  return person(payload.fiduciaries.spouse_trustee_co)
}

function testamentaryCoTrusteesAction(
  value: DraftPayload['will_provisions']['cotrustee_decision_standard'],
): string {
  return value === 'unanimous' ? 'unanimous' : 'majority'
}

export function deriveEstateGeneratorPackage(payload: DraftPayload): EstateGeneratorPackage | undefined {
  return deriveEstateGeneratorPackages(payload).find(packageName => packageName !== 'estate-plan-summary')
}

export function deriveEstateGeneratorPackages(payload: DraftPayload): EstateGeneratorPackage[] {
  const docs = payload.documents
  const packages: EstateGeneratorPackage[] = []

  if (docs.include_trust && payload.matter.type === 'married_joint') {
    packages.push(payload.trust?.separate_trusts ? 'joint-trust-simplified' : 'joint-trust')
  } else if (docs.include_trust) {
    // The disclaimer trust is a married-individual structure (it disposes to a
    // surviving spouse), so it only applies when a spouse exists. Unmarried
    // individuals always get the plain individual revocable trust.
    const isDisclaimer =
      docs.trust_planning_type === 'disclaimer' && payload.matter.type === 'married_individual'
    packages.push(isDisclaimer ? 'indv-disclaimer-trust' : 'trust-individual-single')
  }

  if (docs.include_simple_will) {
    packages.push('simple-will')
  }

  if (docs.include_testamentary_trust_will) {
    packages.push('testamentary-trust-will')
    if (docs.spouse_docs) {
      packages.push('spouse-testamentary-trust-will')
    }
  }

  if (docs.include_pour_over_will) {
    packages.push('pourover-will')
    if (docs.spouse_docs) {
      packages.push('spouse-pourover-will')
    }
  }

  // The College Preparation Plan replaces the estate incapacity set with the
  // student's own documents, drafted from `decisions.college_prep`. The
  // advance directive is a separate package because the student may decline
  // written treatment instructions and leave everything to the agent.
  const college = payload.college_prep ?? null
  if (college) {
    if (docs.include_dpoa) {
      packages.push('college-financial-poa')
    }
    if (docs.include_education_poa) {
      packages.push('college-education-poa')
    }
    if (docs.include_hcp || docs.include_hipaa) {
      packages.push('college-health-care-documents')
    }
    if (docs.include_ahd && college.living_will_include === 'yes') {
      packages.push('college-advance-directive')
    }
  } else if (docs.include_dpoa || docs.include_hcp || docs.include_hipaa || docs.include_ahd) {
    packages.push('incapacity-documents')
    if (docs.spouse_docs) {
      packages.push('spouse-incapacity-documents')
    }
  }

  if (docs.include_ppm) {
    packages.push('personal-property-memorandum')
  }

  if (docs.include_parental_appointment) {
    packages.push('parental-guardian-appointment')
  }

  if (docs.include_temp_delegation) {
    packages.push('temporary-delegation-parental-powers')
  }

  if (docs.include_certificate_of_trust) {
    packages.push('certificate-of-trust')
  }

  if (docs.include_assignment_of_personal_property) {
    packages.push('assignment-of-personal-property')
  }

  if (docs.include_funding_instructions) {
    packages.push('funding-instructions')
  }

  if (docs.include_funding_recommendation) {
    packages.push('trust-funding-plan')
  }

  if (docs.include_homestead_trustee) {
    packages.push('homestead-trustee')
  }

  if (docs.include_young_adult_estate_plan) {
    packages.push('young-adult-estate-plan')
  }

  if (docs.include_ferpa_release) {
    packages.push('ferpa-release')
  }

  if (docs.include_will_cp) {
    packages.push('will-cp')
  }

  if (packages.length > 0 && docs.include_estate_plan_summary !== false) {
    packages.push('estate-plan-summary')
  }

  return packages
}

export function unsupportedEstateGeneratorDocumentLabels(_payload: DraftPayload): string[] {
  return []
}

export function estateGeneratorBlockingError(_payload: DraftPayload): string | undefined {
  return undefined
}

export function estateGeneratorCoverageWarnings(payload: DraftPayload): string[] {
  const warnings: string[] = []
  const unsupported = unsupportedEstateGeneratorDocumentLabels(payload)

  if (unsupported.length > 0) {
    warnings.push(`Selected documents are not yet backed by estate generator packages: ${unsupported.join(', ')}.`)
  }

  return warnings
}

export function clientSlugFromPayload(payload: DraftPayload): string {
  return (
    firstText(payload.client.full_name, payload.matter.matter_number, payload.matter.id) ?? payload.matter.id
  ).replace(/[^a-zA-Z0-9_-]+/g, '-')
}

export function toEstateGeneratorData(payload: DraftPayload): EstateGeneratorData {
  const docs = payload.documents
  const includesWill = docs.include_pour_over_will
    || docs.include_simple_will
    || docs.include_testamentary_trust_will
    || docs.include_will_cp === true
  const showTrustee = Boolean(docs.include_trust && payload.fiduciaries.trustee_initial)
  const showPersonalRepresentative = Boolean(includesWill && payload.fiduciaries.pr_primary)
  const showDpoaAgent = Boolean(docs.include_dpoa && payload.fiduciaries.dpoa_primary)
  const showHealthcareAgent = Boolean(docs.include_hcp && payload.fiduciaries.hcp_primary)
  const showGuardian = Boolean(
    payload.fiduciaries.guardian_primary
    && (docs.include_parental_appointment || payload.matter.minor_children),
  )
  const hasSummaryCompletionItems = Boolean(
    (docs.include_trust && !payload.fiduciaries.trustee_successor)
    || (includesWill && !payload.fiduciaries.pr_successor)
    || (docs.include_dpoa && !payload.fiduciaries.dpoa_successor)
    || (docs.include_hcp && !payload.fiduciaries.hcp_successor),
  )
  const clientPronouns = pronounsFromPreference(payload.client.preferred_pronoun)
  const spousePronouns = pronounsFromPreference(payload.spouse?.preferred_pronoun)
  // Prefer the full signing date the sheet stores; the month/year fallback
  // covers legacy sheets that never captured a day (it can only guess the 1st).
  const signingDate = formatLongDate(payload.execution.signing_date)
    ?? (payload.execution.signing_year && payload.execution.signing_month
      ? `${payload.execution.signing_month} 1, ${payload.execution.signing_year}`
      : undefined)
  const notaryCommission = formatLongDate(payload.execution.notary_commission_expiration) ??
    payload.execution.notary_commission_expiration

  const trustDate = formatLongDate(payload.trust?.date) ?? payload.trust?.date ?? undefined
  const clientDateOfBirth = formatLongDate(payload.client.dob) ?? payload.client.dob ?? ''
  const hasMinorChildren = payload.matter.minor_children
  const trustProvisions = payload.trust_provisions ?? defaultDraftPayloadTrustProvisions()
  const distributionAges = payload.trust?.distribution_ages ?? []
  const descendantsMethod = descendantsDistributionMethod(trustProvisions.residual_beneficiary_method)
  const distributionAge = trustProvisions.distribution_age ?? distributionAges[0] ?? null
  const staggerAges = trustProvisions.staggered_distributions
    .map(tier => tier.age)
    .filter((age): age is number => typeof age === 'number' && Number.isFinite(age))
  const remoteIndividuals = trustProvisions.remote_beneficiary_individual_names.length > 0
    ? trustProvisions.remote_beneficiary_individual_names.map(name => person(name))
    : trustProvisions.remote_beneficiary === 'named'
      ? []
      : ['heirs at law']
  const remoteCharityName = trustProvisions.remote_beneficiary_charity_names[0] ?? ''
  const children = payload.children
    .map(child => ({
      full_name: firstText(child.full_name) ?? '',
      date_of_birth: formatLongDate(child.dob) ?? child.dob ?? '',
      dob: child.dob ?? '',
      relationship: child.relationship ?? '',
      parentage: child.parentage ?? '',
      gender: child.gender ?? '',
      gender_display: childGenderDisplay(child.gender ?? null),
      deceased: child.deceased === true,
      minor: child.minor,
      young_adult_estate_plan: isYoungAdultEstatePlanAge(child.dob),
    }))
    .filter(child => child.full_name)
  const familyProvisions: DraftPayloadFamilyProvisions = payload.family_provisions ?? draftPayloadFamilyProvisions(null)
  const isMarried = Boolean(payload.spouse)
  const sheetChildren = payload.children.map(child => ({
    name: child.full_name,
    dob: child.dob,
    gender: child.gender ?? null,
    deceased: child.deceased === true,
    relationship: (child.relationship ?? 'biological') as DesignSheetChild['relationship'],
    parentage: child.parentage ?? null,
    is_minor: child.minor,
  }))
  const blendedFamily = draftPayloadBlendedFamily(sheetChildren, isMarried)
  const blended = hasBlendedFamily(sheetChildren, isMarried)
  const disinherited = familyProvisions.disinherited.map(entry => person(entry.full_name, {
    relationship: entry.relationship,
  }))
  const { specificGifts, charitableGifts } = normalizeSpecificBequests(payload.will_provisions.specific_bequests)
  const fiduciaryDisplay = payload.fiduciary_display ?? getDraftPayloadFiduciaryDisplay({ decisions: null })
  const fiduciaryDetails = payload.fiduciary_details
  const payloadAssets = payload.assets ?? []
  const fundingPlan = payload.funding_plan ?? { narrative: null, checklist_items: [] }
  const assetValueTotal = payloadAssets.reduce((sum, asset) => {
    const value = asset.estimated_value
    return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum
  }, 0)
  const excludedGuardians = payload.excluded_guardians?.length
    ? payload.excluded_guardians
    : payload.client.excluded_guardian
      ? [{ full_name: payload.client.excluded_guardian, reason: null }]
      : []
  const hcpProvisions = payload.hcp_provisions
  const hipaaProvisions = payload.hipaa_provisions
  const ferpa = payload.ferpa_release ?? null
  const collegePrep = payload.college_prep ?? null
  const hipaaClientAgents = hipaaProvisions.client_additional_agents ?? []
  const hipaaSpouseAgents = hipaaProvisions.spouse_additional_agents ?? []

  function fiduciaryPerson(
    detail: DraftPayloadContactDetail | null | undefined,
    fallbackName: string | null | undefined,
    fallbackExtra: Record<string, unknown> = {},
  ) {
    return generatorPersonFromContactDetail(detail, fallbackName, fallbackExtra, fiduciaryDisplay)
  }

  return {
    extras: payload.extras ?? {},
    client: {
      ...compactObject({
        full_name: payload.client.full_name,
        // Summary documents address the client by first name and fall back to
        // the full name when it is blank; compactObject drops the empty string.
        first_name: payload.client.first_name,
        last_name: payload.client.last_name,
        aka: payload.client.aka,
        street_address: payload.client.address,
        city: payload.client.city,
        state: normalizeJurisdictionStateCode(payload.client.state),
        zip: payload.client.zip,
        county: payload.client.county ?? payload.execution.signing_county,
        signing_county: payload.execution.signing_county,
        email: payload.client.email,
        phone: formatPhoneDisplay(payload.client.phone),
        pronoun_subject: clientPronouns.subject,
        pronoun_object: clientPronouns.object,
        pronoun_possessive: clientPronouns.possessive,
      }),
      date_of_birth: clientDateOfBirth,
    },
    spouse: payload.spouse
      ? compactObject({
          exists: true,
          full_name: payload.spouse.full_name,
          first_name: payload.spouse.first_name,
          last_name: payload.spouse.last_name,
          aka: payload.spouse.aka,
          email: payload.spouse.email,
          phone: formatPhoneDisplay(payload.spouse.phone),
          date_of_birth: formatLongDate(payload.spouse.dob) ?? payload.spouse.dob,
          pronoun_subject: spousePronouns.subject,
          pronoun_object: spousePronouns.object,
          pronoun_possessive: spousePronouns.possessive,
        })
      : { exists: false },
    marriage: {
      date: formatLongDate(payload.marriage?.date) ?? payload.marriage?.date ?? '',
    },
    children,
    summary: {
      show_spouse: Boolean(payload.spouse),
      show_trustee: showTrustee,
      show_personal_representative: showPersonalRepresentative,
      show_dpoa_agent: showDpoaAgent,
      show_healthcare_agent: showHealthcareAgent,
      show_guardian: showGuardian,
      has_completion_items: hasSummaryCompletionItems,
      show_key_people: showTrustee
        || showPersonalRepresentative
        || showDpoaAgent
        || showHealthcareAgent
        || showGuardian,
    },
    planning: {
      uses_revocable_trust: Boolean(payload.trust),
      has_minor_children: hasMinorChildren,
      include_trust: docs.include_trust,
      include_pour_over_will: docs.include_pour_over_will,
      include_simple_will: docs.include_simple_will,
      include_testamentary_trust_will: docs.include_testamentary_trust_will,
      include_dpoa: docs.include_dpoa,
      include_hcp: docs.include_hcp,
      include_hipaa: docs.include_hipaa,
      include_ahd: docs.include_ahd,
      include_ppm: docs.include_ppm,
      include_parental_appointment: docs.include_parental_appointment,
      include_young_adult_estate_plan: docs.include_young_adult_estate_plan,
      include_ferpa_release: docs.include_ferpa_release,
      include_education_poa: docs.include_education_poa,
      // Ancillary inclusions the design sheet already tracks. The interview
      // worksheet prints them as document check boxes, so they have to reach
      // the templates rather than stopping at package selection.
      include_certificate_of_trust: docs.include_certificate_of_trust ?? false,
      include_assignment_of_personal_property: docs.include_assignment_of_personal_property ?? false,
      include_funding_instructions: docs.include_funding_instructions ?? false,
      include_homestead_trustee: docs.include_homestead_trustee ?? false,
      include_estate_plan_summary: docs.include_estate_plan_summary ?? false,
      spouse_docs: docs.spouse_docs,
      client_goals: payload.goals_notes ?? null,
      client_concerns: payload.concerns ?? null,
    },
    will: {
      pr_structure: payload.will_provisions.pr_structure ?? 'single',
      bond: payload.will_provisions.bond,
      supervision: payload.will_provisions.supervision,
      simultaneous_death: payload.will_provisions.simultaneous_death ?? 'omit',
      utma_age: payload.will_provisions.utma_age ?? 21,
      no_contest_clause: trustProvisions.include_no_contest_clause ? 'include' : payload.will_provisions.no_contest_clause,
      include_disclaimer_article: payload.will_provisions.include_disclaimer_article,
      include_self_proving_affidavit: payload.will_provisions.include_self_proving_affidavit,
      tangible_personal_property: {
        distribution_method: payload.will_provisions.tangible_property_distribution ?? 'children_then_descendants',
        named_individual: person(payload.will_provisions.tangible_property_named_individual),
      },
      pr_powers: { ...payload.will_provisions.pr_powers },
      pet_care: petCareProvision(payload),
    },
    trust: compactObject({
      name: payload.trust?.name,
      spouse_name: payload.trust?.spouse_name,
      display_name: payload.trust?.display_name,
      spouse_display_name: payload.trust?.spouse_display_name,
      date: trustDate,
      restatement: trustProvisions.restatement,
      spousal_funding: trustProvisions.spousal_funding,
      initial_trustee_nomination: trustProvisions.initial_trustee_nomination,
      trustee_compensation: trustProvisions.trustee_compensation,
      successor_trustee_vacancy: trustProvisions.successor_trustee_vacancy,
      residual_beneficiary: trustProvisions.residual_beneficiary,
      residuary_after_death: trustProvisions.residuary_after_death,
      include_common_trust_for_children: trustProvisions.include_common_trust_for_children,
      special_distributions_age: trustProvisions.special_distributions_age,
      representation_type: trustProvisions.representation_type,
      survivorship_requirement_days: trustProvisions.survivorship_requirement_days,
      trust_protector_requested: trustProvisions.trust_protector,
      trust_protector: person(trustProvisions.trust_protector_name),
      name_format: trustProvisions.client_name_format,
      spouse_name_format: trustProvisions.spouse_name_format,
      provisions: compactObject({
        protect_us_trust_status: trustProvisions.protect_us_trust_status || undefined,
        allow_special_trustee: trustProvisions.allow_special_trustee || undefined,
        special_trustee_instructions: trustProvisions.special_trustee_instructions ?? undefined,
        power_529_plans: trustProvisions.power_529_plans || undefined,
        power_farms_ranches: trustProvisions.power_farms_ranches || undefined,
        power_closely_held_businesses: trustProvisions.power_closely_held_businesses || undefined,
        power_professional_corporations: trustProvisions.power_professional_corporations || undefined,
        subchapter_s_provisions: trustProvisions.subchapter_s_provisions || undefined,
        allow_trustee_change_situs: trustProvisions.allow_trustee_change_situs || undefined,
        hold_distributions_for_young_beneficiaries: trustProvisions.hold_distributions_for_young_beneficiaries || undefined,
        include_substance_abuse: trustProvisions.include_substance_abuse || undefined,
        include_creditor_divorce_provisions: trustProvisions.include_creditor_divorce_provisions || undefined,
        include_contingent_snt: trustProvisions.include_contingent_snt || undefined,
        allow_distributions_to_dependents_if_incapacitated: trustProvisions.allow_distributions_to_dependents_if_incapacitated || undefined,
        include_no_contest_clause: trustProvisions.include_no_contest_clause || undefined,
        name_people_in_no_contest_clause: trustProvisions.name_people_in_no_contest_clause || undefined,
        require_mandatory_arbitration: trustProvisions.require_mandatory_arbitration || undefined,
        prorate_estate_taxes: trustProvisions.prorate_estate_taxes || undefined,
        include_discretionary_distribution_definition: trustProvisions.include_discretionary_distribution_definition || undefined,
        include_education_expenses_definition: trustProvisions.include_education_expenses_definition || undefined,
        include_arts_education: trustProvisions.include_arts_education || undefined,
        include_vocational_training: trustProvisions.include_vocational_training || undefined,
        include_homeschooling: trustProvisions.include_homeschooling || undefined,
        include_disappearance_definition: trustProvisions.include_disappearance_definition || undefined,
      }),
      contingent_beneficiary: person(payload.will_provisions.single_beneficiary_remainder),
      tangible_personal_property: {
        distribution_method: payload.will_provisions.tangible_property_distribution ?? 'memorandum',
      },
      descendants_distribution: {
        // Absent, not defaulted, when no method is set — the preflight's
        // required-field check is what surfaces it to the attorney.
        method: descendantsMethod ?? undefined,
        distribution_age: distributionAge?.toString(),
        stage_1_age: (staggerAges[0] ?? distributionAges[0])?.toString(),
        stage_2_age: (staggerAges[1] ?? distributionAges[1])?.toString(),
        stage_3_age: (staggerAges[2] ?? distributionAges[2])?.toString(),
      },
      remote_beneficiaries: {
        method: trustProvisions.remote_beneficiary ?? 'heirs_at_law',
        individuals: remoteIndividuals,
        charity: {
          name: remoteCharityName,
        },
      },
      disinherited,
      blended_family: blended ? blendedFamily : undefined,
      disinherit_issue: familyProvisions.disinherit_issue,
    }),
    pour_over: {
      alternate_disposition: payload.will_provisions.pour_over_alternate_disposition ?? 'spouse_then_descendants',
      alternate_named: person(payload.will_provisions.pour_over_alternate_named),
      alternate_disposition_text: pourOverAlternateDispositionText(payload),
    },
    outright_will: {
      residuary: {
        disposition: outrightResiduaryDisposition(payload),
        named: person(payload.will_provisions.outright_residuary_named),
        alternate: person(payload.will_provisions.outright_residuary_alternate),
      },
    },
    dpoa: {
      coagent_manner: payload.dpoa_provisions.coagent_manner,
      coagent_serving: payload.dpoa_provisions.coagent_serving,
      include_section_l: payload.dpoa_provisions.include_section_l,
      include_entity_powers: payload.dpoa_provisions.include_entity_powers,
      include_advanced_trust_gifting: payload.dpoa_provisions.include_advanced_trust_gifting,
      include_extended_personal_care: payload.dpoa_provisions.include_extended_personal_care,
      agent_compensation: payload.dpoa_provisions.agent_compensation,
      allow_gifts: payload.dpoa_provisions.allow_gifts,
      all_basic_powers: payload.dpoa_provisions.all_basic_powers,
      basic_powers: payload.dpoa_provisions.basic_powers,
      additional_powers: payload.dpoa_provisions.additional_powers,
      specific_businesses: payload.dpoa_provisions.specific_businesses,
      additional_limitations: payload.dpoa_provisions.additional_limitations,
      include_trust_powers: payload.dpoa_provisions.include_trust_powers,
      trust_powers: payload.dpoa_provisions.trust_powers,
      special_powers: payload.dpoa_provisions.special_powers,
      self_dealing_reviewer: person(payload.dpoa_provisions.self_dealing_reviewer),
      self_dealing_reviewer_alt: person(payload.dpoa_provisions.self_dealing_reviewer_alt),
    },
    testamentary_trust: {
      trustee_structure: payload.will_provisions.trustee_structure ?? '',
      beneficiary_structure: payload.will_provisions.beneficiary_structure ?? '',
      age_distribution_schedule: payload.will_provisions.age_distribution_schedule ?? '',
      single_beneficiary: person(payload.will_provisions.single_beneficiary_name),
      remainder_beneficiary: person(payload.will_provisions.single_beneficiary_remainder),
      trust_protector_requested: Boolean(payload.will_provisions.trust_protector),
      trust_protector: person(payload.will_provisions.trust_protector_name),
    },
    fiduciaries: {
      executor: {
        primary: fiduciaryPerson(fiduciaryDetails?.executor.primary, payload.fiduciaries.pr_primary),
        co_primary: fiduciaryPerson(fiduciaryDetails?.executor.co_primary, payload.fiduciaries.pr_co_primary),
        successor: fiduciaryPerson(fiduciaryDetails?.executor.successor, payload.fiduciaries.pr_successor),
        co_successor: fiduciaryPerson(fiduciaryDetails?.executor.co_successor, payload.fiduciaries.pr_co_successor),
        second_successor: fiduciaryPerson(fiduciaryDetails?.executor.second_successor, payload.fiduciaries.pr_second_successor),
      },
      spouse_executor: {
        primary: fiduciaryPerson(fiduciaryDetails?.spouse_executor.primary, payload.fiduciaries.spouse_pr_primary),
        co_primary: person(payload.fiduciaries.spouse_pr_co_primary),
        successor: fiduciaryPerson(fiduciaryDetails?.spouse_executor.successor, payload.fiduciaries.spouse_pr_successor),
        co_successor: person(null),
        second_successor: person(null),
      },
      trustee: {
        primary: fiduciaryPerson(
          fiduciaryDetails?.trustee.primary,
          firstText(payload.fiduciaries.trustee_initial, payload.client.full_name),
        ),
        co_primary: fiduciaryPerson(fiduciaryDetails?.trustee.co_primary, payload.fiduciaries.trustee_co),
        successor: fiduciaryPerson(fiduciaryDetails?.trustee.successor, payload.fiduciaries.trustee_successor),
        co_successor: fiduciaryPerson(fiduciaryDetails?.trustee.co_successor, payload.fiduciaries.trustee_co_successor),
        second_successor: fiduciaryPerson(fiduciaryDetails?.trustee.second_successor, payload.fiduciaries.trustee_second_successor),
        co_second_successor: fiduciaryPerson(fiduciaryDetails?.trustee.co_second_successor, payload.fiduciaries.trustee_co_second_successor),
        co_trustees_action: trustCoTrusteesAction(trustProvisions.co_trustee_decision)
          || payload.will_provisions.cotrustee_decision_standard
          || 'joint',
      },
      testamentary_trustee: {
        primary: fiduciaryPerson(fiduciaryDetails?.trustee.primary, payload.fiduciaries.trustee_initial),
        co_primary: testamentaryCoTrustee(payload),
        successor: fiduciaryPerson(fiduciaryDetails?.trustee.successor, payload.fiduciaries.trustee_successor),
        co_trustees_action: testamentaryCoTrusteesAction(payload.will_provisions.cotrustee_decision_standard),
      },
      // The spouse's own trustee set. On a separate-trusts matter each spouse
      // has their own trust, and the design sheet keeps the second set in
      // `spouse_trustee_slots`; `spouse_testamentary_trustee` reads the same
      // slots for the will's testamentary trust and stays as it was.
      spouse_trustee: {
        primary: fiduciaryPerson(
          undefined,
          payload.fiduciaries.spouse_trustee_primary ?? payload.fiduciaries.spouse_trustee_successor,
        ),
        co_primary: person(payload.fiduciaries.spouse_trustee_co),
        successor: payload.fiduciaries.spouse_trustee_primary
          ? fiduciaryPerson(undefined, payload.fiduciaries.spouse_trustee_successor)
          : person(null),
      },
      spouse_testamentary_trustee: {
        // Legacy payloads carried the primary in spouse_trustee_successor;
        // fall back so stored payloads keep rendering the same person.
        primary: fiduciaryPerson(
          undefined,
          payload.fiduciaries.spouse_trustee_primary ?? payload.fiduciaries.spouse_trustee_successor,
        ),
        co_primary: spouseTestamentaryCoTrustee(payload),
        successor: payload.fiduciaries.spouse_trustee_primary
          ? fiduciaryPerson(undefined, payload.fiduciaries.spouse_trustee_successor)
          : person(null),
        co_trustees_action: testamentaryCoTrusteesAction(payload.will_provisions.cotrustee_decision_standard),
      },
      agent: {
        primary: fiduciaryPerson(fiduciaryDetails?.agent.primary, payload.fiduciaries.dpoa_primary),
        co_primary: fiduciaryPerson(fiduciaryDetails?.agent.co_primary, payload.fiduciaries.dpoa_co_agent),
        successor: fiduciaryPerson(fiduciaryDetails?.agent.successor, payload.fiduciaries.dpoa_successor),
        co_agents_action: poaCoAgentsAction(payload.dpoa_provisions.coagent_manner),
        primary_has_spouse: Boolean(payload.spouse),
      },
      spouse_agent: {
        primary: fiduciaryPerson(fiduciaryDetails?.spouse_agent.primary, payload.fiduciaries.spouse_dpoa_primary),
        co_primary: fiduciaryPerson(fiduciaryDetails?.spouse_agent.co_primary, payload.fiduciaries.spouse_dpoa_co),
        successor: fiduciaryPerson(fiduciaryDetails?.spouse_agent.successor, payload.fiduciaries.spouse_dpoa_successor),
        co_agents_action: poaCoAgentsAction(payload.dpoa_provisions.coagent_manner),
        primary_has_spouse: Boolean(payload.client.full_name),
      },
    },
    fiduciary_display: { ...fiduciaryDisplay } as Record<string, unknown>,
    healthcare: {
      agent: {
        primary: fiduciaryPerson(fiduciaryDetails?.healthcare_agent.primary, payload.fiduciaries.hcp_primary, {
          relationship: payload.fiduciaries.hcp_primary_relationship ?? null,
          address: payload.fiduciaries.hcp_primary_address ?? payload.client.address ?? '',
        }),
        co_primary: fiduciaryPerson(fiduciaryDetails?.healthcare_agent.co_primary, payload.fiduciaries.hcp_co, {
          relationship: payload.fiduciaries.hcp_co_relationship ?? null,
          address: payload.fiduciaries.hcp_co_address ?? '',
        }),
        alternate: fiduciaryPerson(fiduciaryDetails?.healthcare_agent.alternate, payload.fiduciaries.hcp_successor, {
          relationship: payload.fiduciaries.hcp_successor_relationship ?? null,
          address: payload.fiduciaries.hcp_successor_address ?? '',
        }),
        co_alternate: fiduciaryPerson(fiduciaryDetails?.healthcare_agent.co_alternate, payload.fiduciaries.hcp_successor_co, {
          relationship: payload.fiduciaries.hcp_successor_co_relationship ?? null,
          address: payload.fiduciaries.hcp_successor_co_address ?? '',
        }),
        // Third agent line on the HCP/HIPAA forms — hcp_slots order 2.
        second_alternate: fiduciaryPerson(fiduciaryDetails?.healthcare_agent.second_alternate, null),
      },
      spouse_agent: {
        primary: fiduciaryPerson(fiduciaryDetails?.spouse_healthcare_agent.primary, payload.fiduciaries.spouse_hcp_primary, {
          relationship: payload.fiduciaries.spouse_hcp_primary_relationship ?? null,
          address: payload.fiduciaries.spouse_hcp_primary_address ?? payload.client.address ?? '',
        }),
        co_primary: fiduciaryPerson(fiduciaryDetails?.spouse_healthcare_agent.co_primary, payload.fiduciaries.spouse_hcp_co, {
          relationship: payload.fiduciaries.spouse_hcp_co_relationship ?? null,
          address: payload.fiduciaries.spouse_hcp_co_address ?? '',
        }),
        alternate: fiduciaryPerson(fiduciaryDetails?.spouse_healthcare_agent.alternate, payload.fiduciaries.spouse_hcp_successor, {
          relationship: payload.fiduciaries.spouse_hcp_successor_relationship ?? null,
          address: payload.fiduciaries.spouse_hcp_successor_address ?? '',
        }),
        co_alternate: fiduciaryPerson(
          fiduciaryDetails?.spouse_healthcare_agent.co_alternate,
          payload.fiduciaries.spouse_hcp_successor_co,
          {
            relationship: payload.fiduciaries.spouse_hcp_successor_co_relationship ?? null,
            address: payload.fiduciaries.spouse_hcp_successor_co_address ?? '',
          },
        ),
      },
      anatomical_gift: hcpProvisions.anatomical_gift,
      anatomical_specified: hcpProvisions.anatomical_specified ?? '',
      client_anatomical_gift: hcpProvisions.client_anatomical_gift,
      spouse_anatomical_gift: hcpProvisions.spouse_anatomical_gift,
      spouse_anatomical_restrictions: hcpProvisions.spouse_anatomical_restrictions,
      client_advance_directive: hcpProvisions.client_advance_directive,
      spouse_advance_directive: hcpProvisions.spouse_advance_directive,
    },
    will_cp: {
      parent1: person(payload.will_cp?.parent1_name),
      parent2: person(payload.will_cp?.parent2_name),
    },
    ferpa: {
      school_name: ferpa?.school_name ?? '',
      school_city: ferpa?.school_city ?? '',
      school_state: ferpa?.school_state ?? '',
      school_location: ferpa?.school_location ?? '',
      student_id: ferpa?.student_id ?? '',
      records: (ferpa?.records ?? []).map(record => ({ key: record.key, label: record.label })),
      all_records: ferpa?.all_records ?? false,
      includes_health_center: ferpa?.includes_health_center ?? false,
      recipients: ferpa?.recipients ?? '',
    },
    college: {
      dpoa_effective: collegePrep?.dpoa_effective ?? '',
      dpoa_powers: (collegePrep?.dpoa_powers ?? []).map(power => ({ key: power.key, label: power.label })),
      dpoa_all_powers: collegePrep?.dpoa_all_powers ?? false,
      dpoa_withheld: collegePrep?.dpoa_withheld ?? '',
      hcp_limits: collegePrep?.hcp_limits ?? '',
      hcp_instructions: collegePrep?.hcp_instructions ?? '',
      hipaa_scope: collegePrep?.hipaa_scope ?? '',
      hipaa_excluded_categories: (collegePrep?.hipaa_excluded_categories ?? []).map(category => ({
        key: category.key,
        label: category.label,
      })),
      hipaa_expiration: collegePrep?.hipaa_expiration ?? '',
      hipaa_expiration_date: formatLongDate(collegePrep?.hipaa_expiration_date)
        ?? collegePrep?.hipaa_expiration_date
        ?? '',
      hipaa_recipients: (collegePrep?.hipaa_recipients ?? []).map(recipient => compactObject({
        name: recipient.name,
        relationship: recipient.relationship ?? undefined,
        phone: formatPhoneDisplay(recipient.phone) || undefined,
      })),
      excluded_people: collegePrep?.excluded_people ?? '',
      living_will_include: collegePrep?.living_will_include ?? '',
      life_support: collegePrep?.life_support ?? '',
      cpr: collegePrep?.cpr ?? '',
      artificial_nutrition: collegePrep?.artificial_nutrition ?? '',
      ventilation: collegePrep?.ventilation ?? '',
      comfort_always: collegePrep?.comfort_always ?? false,
      organ_donation: collegePrep?.organ_donation ?? '',
      organ_donation_notes: collegePrep?.organ_donation_notes ?? '',
    },
    hipaa: {
      psychotherapy_notes: hipaaProvisions.psychotherapy_notes,
      include_poa: hipaaProvisions.include_poa,
      include_trustees: hipaaProvisions.include_trustees,
      list_fiduciaries_by_name: hipaaProvisions.list_fiduciaries_by_name,
      client_additional_agents: hipaaClientAgents.map(agent => person(agent.full_name, {
        relationship: agent.relationship,
        address: agent.address,
        phone: agent.phone,
        email: agent.email,
        date_of_birth: agent.date_of_birth,
      })),
      spouse_additional_agents: hipaaSpouseAgents.map(agent => person(agent.full_name, {
        relationship: agent.relationship,
        address: agent.address,
        phone: agent.phone,
        email: agent.email,
        date_of_birth: agent.date_of_birth,
      })),
    },
    execution: compactObject({
      signing_scheduled: Boolean(signingDate || payload.execution.signing_county || notaryCommission),
      doc_date: signingDate,
      ordinal_doc_date: formatOrdinalDate(signingDate),
      signing_county: payload.execution.signing_county,
      notary_commission: notaryCommission,
      id_type: 'government-issued photo identification',
    }),
    specific_gifts: specificGifts,
    charitable_gifts: charitableGifts,
    guardians: {
      primary: fiduciaryPerson(fiduciaryDetails?.guardians.primary, payload.fiduciaries.guardian_primary),
      co_primary: fiduciaryPerson(
        fiduciaryDetails?.guardians.co_primary,
        payload.fiduciaries.guardian_co,
      ),
      successor: fiduciaryPerson(fiduciaryDetails?.guardians.successor, payload.fiduciaries.guardian_successor),
      co_successor: fiduciaryPerson(
        fiduciaryDetails?.guardians.co_successor,
        payload.fiduciaries.guardian_co_successor,
      ),
      second_successor: fiduciaryPerson(fiduciaryDetails?.guardians.second_successor, payload.fiduciaries.guardian_second_successor),
      co_second_successor: fiduciaryPerson(
        fiduciaryDetails?.guardians.co_second_successor,
        payload.fiduciaries.guardian_co_second_successor,
      ),
      temporary: fiduciaryPerson(fiduciaryDetails?.guardians.temporary, payload.fiduciaries.temp_guardian_primary),
      temporary_co: fiduciaryPerson(fiduciaryDetails?.guardians.temporary_co, payload.fiduciaries.temp_guardian_co),
      temporary_successor: fiduciaryPerson(fiduciaryDetails?.guardians.temporary_successor, payload.fiduciaries.temp_guardian_successor),
      temporary_second_successor: fiduciaryPerson(fiduciaryDetails?.guardians.temporary_second_successor, payload.fiduciaries.temp_guardian_second_successor),
      excluded: excludedGuardians.map(entry => person(entry.full_name, { reason: entry.reason })),
    },
    family: {
      blended_family: blended,
      include_child_gender_markers: familyProvisions.include_child_gender_markers,
      include_afterborn_children: familyProvisions.include_afterborn_children,
      include_expectant_children: familyProvisions.include_expectant_children,
      omissions_intentional: familyProvisions.omissions_intentional,
      include_general_disinheritance: familyProvisions.include_general_disinheritance,
      disinherit_issue: familyProvisions.disinherit_issue,
      additional_disinheritance_language: familyProvisions.additional_disinheritance_language,
      disinherited,
    },
    assets: {
      real_property: draftPayloadHasRealProperty(payloadAssets),
      total_gross_value: assetValueTotal > 0 ? formatMoney(assetValueTotal) : '',
      total_net_value: assetValueTotal > 0 ? formatMoney(assetValueTotal) : '',
      items: payloadAssets.map(asset => ({
        category: asset.category,
        category_label: assetCategoryLabel(asset.category),
        description: asset.description,
        institution: asset.institution,
        owner: null,
        estimated_value: formatMoney(asset.estimated_value),
        gross_value: formatMoney(asset.estimated_value),
        net_value: formatMoney(asset.estimated_value),
        notes: asset.notes,
        from_intake: asset.from_intake,
      })),
    },
    funding_plan: {
      narrative: fundingPlan.narrative ?? '',
      checklist_items: fundingPlan.checklist_items ?? [],
    },
    homestead: {
      ...(payload.homestead ?? {
        beneficiary_names: '',
        primary_beneficiary_name: '',
        beneficiary_pronoun_possessive: 'their',
        trustee_pronoun_possessive: 'his/her/their',
        servicemember_names: '',
        property_address_line: '',
        trust_deed_book: '',
        trust_deed_page: '',
        deed_registry_district: '',
        deed_book: '',
        deed_page: '',
        certificate_number: '',
        land_court_document_number: '',
      }),
    } as Record<string, unknown>,
    tax: {
      sensitive_estate: payload.trust?.ma_estate_taxable ?? false,
    },
    drafting_notes: firstText(payload.special_provisions, payload.notes),
  }
}
