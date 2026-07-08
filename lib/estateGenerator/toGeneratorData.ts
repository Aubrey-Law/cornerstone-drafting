import type { DraftPayload } from '@/lib/buildDraftPayload'
import { formatPhoneDisplay } from '@/lib/phone'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { isYoungAdultEstatePlanAge } from '@/lib/youngAdultEstatePlan'

export type EstateGeneratorPackage =
  | 'core-estate'
  | 'estate-plan-summary'
  | 'incapacity-documents'
  | 'indv-disclaimer-trust'
  | 'joint-trust'
  | 'joint-trust-simplified'
  | 'parental-guardian-appointment'
  | 'personal-property-memorandum'
  | 'pourover-will'
  | 'simple-will'
  | 'spouse-incapacity-documents'
  | 'spouse-pourover-will'
  | 'spouse-testamentary-trust-will'
  | 'testamentary-trust-will'
  | 'trust-individual-single'
  | 'young-adult-estate-plan'

export interface EstateGeneratorData {
  client: Record<string, unknown>
  spouse?: Record<string, unknown>
  children: Array<Record<string, unknown>>
  planning: Record<string, unknown>
  will: Record<string, unknown>
  trust: Record<string, unknown>
  pour_over: Record<string, unknown>
  outright_will: Record<string, unknown>
  dpoa: Record<string, unknown>
  testamentary_trust: Record<string, unknown>
  fiduciaries: Record<string, unknown>
  healthcare: Record<string, unknown>
  hipaa: Record<string, unknown>
  execution: Record<string, unknown>
  specific_gifts: unknown[]
  charitable_gifts: unknown[]
  guardians: Record<string, unknown>
  family: Record<string, unknown>
  assets: Record<string, unknown>
  tax: Record<string, unknown>
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

    const gift = { item, recipient }
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

  if (docs.include_dpoa || docs.include_hcp || docs.include_hipaa || docs.include_ahd) {
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

  if (docs.include_young_adult_estate_plan) {
    packages.push('young-adult-estate-plan')
  }

  return packages.length > 0 ? [...packages, 'estate-plan-summary'] : packages
}

export function unsupportedEstateGeneratorDocumentLabels(payload: DraftPayload): string[] {
  const docs = payload.documents
  const labels: string[] = []

  if (docs.include_temp_delegation) labels.push('Temporary delegation of parental powers')

  return labels
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
  const clientPronouns = pronounsFromPreference(payload.client.preferred_pronoun)
  const spousePronouns = pronounsFromPreference(payload.spouse?.preferred_pronoun)
  const signingDate = payload.execution.signing_year && payload.execution.signing_month
    ? `${payload.execution.signing_month} 1, ${payload.execution.signing_year}`
    : undefined
  const notaryCommission = formatLongDate(payload.execution.notary_commission_expiration) ??
    payload.execution.notary_commission_expiration

  const trustDate = formatLongDate(payload.trust?.date) ?? payload.trust?.date ?? undefined
  const clientDateOfBirth = formatLongDate(payload.client.dob) ?? payload.client.dob ?? ''
  const hasMinorChildren = payload.matter.minor_children
  const distributionAges = payload.trust?.distribution_ages ?? []
  const descendantsDistributionMethod = payload.will_provisions.age_distribution_schedule?.includes('stagger')
    ? 'staged'
    : payload.will_provisions.age_distribution_schedule ?? 'staged'
  const children = payload.children
    .map(child => ({
      full_name: firstText(child.full_name) ?? '',
      date_of_birth: formatLongDate(child.dob) ?? child.dob ?? '',
      dob: child.dob ?? '',
      relationship: child.relationship ?? '',
      minor: child.minor,
      young_adult_estate_plan: isYoungAdultEstatePlanAge(child.dob),
    }))
    .filter(child => child.full_name)
  const { specificGifts, charitableGifts } = normalizeSpecificBequests(payload.will_provisions.specific_bequests)

  return {
    client: {
      ...compactObject({
        full_name: payload.client.full_name,
        aka: payload.client.aka,
        street_address: payload.client.address,
        city: payload.client.city,
        state: normalizeJurisdictionStateCode(payload.client.state),
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
          date_of_birth: formatLongDate(payload.spouse.dob) ?? payload.spouse.dob,
          pronoun_subject: spousePronouns.subject,
          pronoun_object: spousePronouns.object,
          pronoun_possessive: spousePronouns.possessive,
        })
      : { exists: false },
    children,
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
      spouse_docs: docs.spouse_docs,
    },
    will: {
      pr_structure: payload.will_provisions.pr_structure ?? 'single',
      bond: payload.will_provisions.bond,
      supervision: payload.will_provisions.supervision,
      simultaneous_death: payload.will_provisions.simultaneous_death ?? 'omit',
      utma_age: payload.will_provisions.utma_age ?? 21,
      no_contest_clause: payload.will_provisions.no_contest_clause,
      include_disclaimer_article: payload.will_provisions.include_disclaimer_article,
      include_self_proving_affidavit: payload.will_provisions.include_self_proving_affidavit,
      tangible_personal_property: {
        distribution_method: payload.will_provisions.tangible_property_distribution ?? 'children_then_descendants',
        named_individual: person(payload.will_provisions.tangible_property_named_individual),
      },
      pet_care: petCareProvision(payload),
    },
    trust: compactObject({
      name: payload.trust?.name,
      date: trustDate,
      contingent_beneficiary: person(payload.will_provisions.single_beneficiary_remainder),
      tangible_personal_property: {
        distribution_method: payload.will_provisions.tangible_property_distribution ?? 'memorandum',
      },
      descendants_distribution: {
        method: descendantsDistributionMethod,
        distribution_age: distributionAges[0]?.toString(),
        stage_1_age: distributionAges[0]?.toString(),
        stage_2_age: distributionAges[1]?.toString(),
        stage_3_age: distributionAges[2]?.toString(),
      },
      remote_beneficiaries: {
        individuals: firstText(payload.will_provisions.single_beneficiary_name) ? [
          person(payload.will_provisions.single_beneficiary_name),
        ] : ['heirs at law'],
        charity: {
          name: '',
        },
      },
      disinherited: payload.client.excluded_guardian ? [person(payload.client.excluded_guardian)] : [],
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
      include_section_l: payload.dpoa_provisions.include_section_l,
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
        primary: person(payload.fiduciaries.pr_primary),
        co_primary: person(payload.fiduciaries.pr_co_primary),
        successor: person(payload.fiduciaries.pr_successor),
        co_successor: person(payload.fiduciaries.pr_co_successor),
        second_successor: person(payload.fiduciaries.pr_second_successor),
      },
      spouse_executor: {
        primary: person(payload.fiduciaries.spouse_pr_primary),
        co_primary: person(null),
        successor: person(payload.fiduciaries.spouse_pr_successor),
        co_successor: person(null),
        second_successor: person(null),
      },
      trustee: {
        primary: person(firstText(payload.fiduciaries.trustee_initial, payload.client.full_name)),
        co_primary: person(payload.fiduciaries.trustee_co),
        successor: person(payload.fiduciaries.trustee_successor),
        co_successor: person(payload.fiduciaries.trustee_co_successor),
        second_successor: person(payload.fiduciaries.trustee_second_successor),
        co_second_successor: person(payload.fiduciaries.trustee_co_second_successor),
        co_trustees_action: payload.will_provisions.cotrustee_decision_standard ?? 'majority',
      },
      testamentary_trustee: {
        primary: person(payload.fiduciaries.trustee_initial),
        co_primary: testamentaryCoTrustee(payload),
        successor: person(payload.fiduciaries.trustee_successor),
        co_trustees_action: testamentaryCoTrusteesAction(payload.will_provisions.cotrustee_decision_standard),
      },
      spouse_testamentary_trustee: {
        primary: person(payload.fiduciaries.spouse_trustee_successor),
        co_primary: person(null),
        successor: person(null),
        co_trustees_action: testamentaryCoTrusteesAction(payload.will_provisions.cotrustee_decision_standard),
      },
      agent: {
        primary: person(payload.fiduciaries.dpoa_primary),
        co_primary: person(payload.fiduciaries.dpoa_co_agent),
        successor: person(payload.fiduciaries.dpoa_successor),
        co_agents_action: poaCoAgentsAction(payload.dpoa_provisions.coagent_manner),
        primary_has_spouse: Boolean(payload.spouse),
      },
      spouse_agent: {
        primary: person(payload.fiduciaries.spouse_dpoa_primary),
        co_primary: person(null),
        successor: person(payload.fiduciaries.spouse_dpoa_successor),
        co_agents_action: poaCoAgentsAction(payload.dpoa_provisions.coagent_manner),
        primary_has_spouse: Boolean(payload.client.full_name),
      },
    },
    healthcare: {
      agent: {
        primary: person(payload.fiduciaries.hcp_primary, {
          relationship: payload.fiduciaries.hcp_primary_relationship ?? null,
          address: payload.fiduciaries.hcp_primary_address ?? payload.client.address ?? '',
          phone: '',
        }),
        alternate: person(payload.fiduciaries.hcp_successor, {
          relationship: payload.fiduciaries.hcp_successor_relationship ?? null,
          address: payload.fiduciaries.hcp_successor_address ?? '',
          phone: '',
        }),
      },
      spouse_agent: {
        primary: person(payload.fiduciaries.spouse_hcp_primary, {
          relationship: payload.fiduciaries.spouse_hcp_primary_relationship ?? null,
          address: payload.fiduciaries.spouse_hcp_primary_address ?? payload.client.address ?? '',
          phone: '',
        }),
        alternate: person(payload.fiduciaries.spouse_hcp_successor, {
          relationship: payload.fiduciaries.spouse_hcp_successor_relationship ?? null,
          address: payload.fiduciaries.spouse_hcp_successor_address ?? '',
          phone: '',
        }),
      },
      anatomical_gift: payload.hcp_provisions.anatomical_gift,
      anatomical_specified: payload.hcp_provisions.anatomical_specified ?? '',
    },
    hipaa: {
      psychotherapy_notes: payload.hipaa_provisions.psychotherapy_notes,
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
      primary: person(payload.fiduciaries.guardian_primary),
      successor: person(payload.fiduciaries.guardian_successor),
      second_successor: person(payload.fiduciaries.guardian_second_successor),
      temporary: person(payload.fiduciaries.temp_guardian_primary),
      temporary_successor: person(payload.fiduciaries.temp_guardian_successor),
      temporary_second_successor: person(payload.fiduciaries.temp_guardian_second_successor),
      excluded: payload.client.excluded_guardian ? [person(payload.client.excluded_guardian)] : [],
    },
    family: {
      blended_family: false,
    },
    assets: {
      real_property: false,
    },
    tax: {
      sensitive_estate: payload.trust?.ma_estate_taxable ?? false,
    },
    drafting_notes: firstText(payload.special_provisions, payload.notes),
  }
}
