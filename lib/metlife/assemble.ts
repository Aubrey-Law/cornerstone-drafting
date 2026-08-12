import { normalizeMatterBillingType } from '@/lib/billing/billingType'
import { feeCents, SERVICE_TYPE_BY_FEE } from '@/lib/metlife/pricing'
import {
  METLIFE_PLAN_TYPES,
  type MetlifeAssemblyResult,
  type MetlifeLineItem,
  type MetlifeMatterDetails,
  type MetlifePlanType,
  type MetlifePreflightIssue,
  type MetlifeRunInput,
  type MetlifeSection,
} from '@/lib/metlife/types'
import type { DraftPayload } from '@/lib/draftPayload/types'

function cleanFilenamePart(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9-]/g, '') || 'Client'
}

function validPlanType(value: unknown): value is MetlifePlanType {
  return METLIFE_PLAN_TYPES.includes(String(value) as MetlifePlanType)
}

function trimmed(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Today in the firm's timezone, as YYYY-MM-DD, for the claim's submission date. */
function firmToday(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

/**
 * Which of the five MetLife compositions this matter bills under. A trust plan
 * for a married couple is `separate_trust` when the design sheet is not joint or
 * the matter carries the separate-trusts flag — the two agree in practice, but a
 * matter saved before the flag existed only has the design sheet to go on.
 */
export function deriveMetlifePlanType(payload: DraftPayload): MetlifePlanType {
  const isCouple = Boolean(payload.spouse)
  const hasTrust = Boolean(payload.documents.include_trust)
  if (!isCouple) return hasTrust ? 'individual_trust' : 'will_individual'
  if (!hasTrust) return 'will_couple'
  const separate = payload.trust?.separate_trusts === true || payload.matter.type === 'married_individual'
  return separate ? 'separate_trust' : 'joint_trust'
}

function planTypeIsCouple(planType: MetlifePlanType) {
  return planType === 'separate_trust' || planType === 'joint_trust' || planType === 'will_couple'
}

function line(
  document: string,
  fee: Parameters<typeof feeCents>[0],
  rate: 'member' | 'couple',
  comment: string,
): MetlifeLineItem {
  return { document, serviceType: SERVICE_TYPE_BY_FEE[fee], feeCents: feeCents(fee, rate), comment }
}

function section(title: string, items: MetlifeLineItem[]): MetlifeSection {
  return { title, items, totalCents: items.reduce((sum, item) => sum + item.feeCents, 0) }
}

/**
 * The incapacity documents, billed once for the pair on a couple plan and once
 * per person otherwise. Each line is gated on the design sheet actually
 * including that document — a claim never bills work the matter does not contain.
 */
function sharedSection(
  payload: DraftPayload,
  planType: MetlifePlanType,
  memberName: string,
  spouseName: string | null,
  includeMinorGuardian: boolean,
): MetlifeSection {
  const couple = planTypeIsCouple(planType)
  const rate = couple ? 'couple' : 'member'
  const suffix = couple ? '(Member and Spouse)' : ''
  const forWhom = couple && spouseName ? 'Member and Spouse' : memberName
  const documents = payload.documents
  const items: MetlifeLineItem[] = []

  if (documents.include_dpoa) {
    items.push(line(`Power of Attorney (Financial)${suffix}`, 'powerOfAttorney', rate, `Financial Power of Attorney for ${forWhom}`))
  }
  if (documents.include_hcp) {
    items.push(line(`Power of Attorney (Medical)${suffix}`, 'powerOfAttorney', rate, `Medical Power of Attorney for ${forWhom}`))
  }
  if (documents.include_hipaa) {
    items.push(line(`Power of Attorney (HIPAA)${suffix}`, 'powerOfAttorney', rate, `HIPAA authorization for ${forWhom}`))
  }
  if (documents.include_ahd) {
    items.push(line(`Advanced Medical Directive${suffix ? ` ${suffix}` : ''}`.trim(), 'advancedMedicalDirective', rate, `Advanced Medical Directive for ${forWhom}`))
  }
  if (includeMinorGuardian) {
    // MetLife bills a minor guardianship as an affidavit; there is no separate rate for it.
    items.push(line('Temporary Guardian Affidavit', 'affidavit', 'member', 'Temporary Guardian Affidavit for minor children'))
  }

  const title = couple && spouseName ? `Shared — ${memberName} and ${spouseName}` : `Shared — ${memberName}`
  return section(title, items)
}

function trustSectionFor(name: string, hasWill: boolean): MetlifeSection {
  const items: MetlifeLineItem[] = []
  if (hasWill) {
    // Separate-trust pour-over wills are non-reciprocal, so each bills at the
    // member rate rather than the $185 couple rate.
    items.push(line(`Last Will and Testament for ${name}`, 'will', 'member', `Pour-over will for ${name} (non-reciprocal)`))
  }
  items.push(line(`Individual Trust No-Tax Planning (${name})`, 'trust', 'member', `Individual revocable trust for ${name}`))
  items.push(line('Affidavit', 'affidavit', 'member', `Affidavit of Trust for the ${name} Revocable Trust`))
  return section(`${name} Trust Claim`, items)
}

function realtySections(planType: MetlifePlanType, count: number): MetlifeSection[] {
  const couple = planTypeIsCouple(planType)
  const suffix = couple ? ' (Member and Spouse)' : ''
  return Array.from({ length: count }, (_, index) => {
    const label = count > 1 ? `Realty Trust and Deed — Property ${index + 1}` : 'Realty Trust and Deed'
    return section(label, [
      line('Deed', 'deed', 'member', 'Quitclaim Deed transferring the property to the Realty Trust'),
      line(`Joint Trust No-Tax Planning${suffix}`, 'trust', 'couple', 'Realty Trust'),
      line('Affidavit', 'affidavit', 'member', 'Affidavit of Trust for the Realty Trust'),
    ])
  })
}

function claimSections(
  payload: DraftPayload,
  planType: MetlifePlanType,
  memberName: string,
  spouseName: string | null,
  realtyTrustCount: number,
  includeMinorGuardian: boolean,
): MetlifeSection[] {
  const documents = payload.documents
  const hasWill = Boolean(
    documents.include_pour_over_will || documents.include_simple_will || documents.include_testamentary_trust_will,
  )
  const sections = [sharedSection(payload, planType, memberName, spouseName, includeMinorGuardian)]

  if (planType === 'separate_trust') {
    sections.push(trustSectionFor(memberName, hasWill))
    if (spouseName) sections.push(trustSectionFor(spouseName, hasWill))
  } else if (planType === 'joint_trust') {
    const items: MetlifeLineItem[] = []
    if (hasWill) {
      items.push(line('Last Will and Testament (Member and Spouse)', 'will', 'couple', `Pour-over wills for ${memberName} and ${spouseName ?? 'Spouse'}`))
    }
    items.push(line('Joint Trust No-Tax Planning (Member and Spouse)', 'trust', 'couple', `Joint revocable trust for ${memberName} and ${spouseName ?? 'Spouse'}`))
    items.push(line('Affidavit', 'affidavit', 'member', 'Affidavit of Trust for the joint Revocable Trust'))
    sections.push(section('Trust Claim', items))
  } else if (planType === 'will_couple') {
    if (hasWill) {
      sections.push(section('Wills', [
        line('Last Will and Testament (Member and Spouse)', 'will', 'couple', `Wills for ${memberName} and ${spouseName ?? 'Spouse'}`),
      ]))
    }
  } else if (planType === 'will_individual') {
    if (hasWill) {
      sections.push(section('Will', [line('Last Will and Testament', 'will', 'member', `Will for ${memberName}`)]))
    }
  } else {
    const items: MetlifeLineItem[] = []
    if (hasWill) items.push(line('Last Will and Testament', 'will', 'member', `Pour-over will for ${memberName}`))
    items.push(line('Individual Trust No-Tax Planning', 'trust', 'member', `Individual revocable trust for ${memberName}`))
    items.push(line('Affidavit', 'affidavit', 'member', `Affidavit of Trust for the ${memberName} Revocable Trust`))
    sections.push(section('Trust Claim', items))
  }

  sections.push(...realtySections(planType, realtyTrustCount))
  return sections.filter(entry => entry.items.length > 0)
}

/**
 * Turn approved matter facts into a MetLife claim, or into the list of facts the
 * attorney still has to supply. Nothing is guessed: a value the matter does not
 * carry becomes an `[UNKNOWN]` preflight issue that blocks generation.
 */
export function assembleMetlifeClaim(
  payload: DraftPayload,
  details: MetlifeMatterDetails = {},
  input: MetlifeRunInput = {},
  now = new Date(),
): MetlifeAssemblyResult {
  const preflight: MetlifePreflightIssue[] = []
  const isCouple = Boolean(payload.spouse)

  if (normalizeMatterBillingType(details.billingType) !== 'metlife') {
    preflight.push({ field: 'billingType', message: 'This matter is not billed to the MetLife Legal Plan. Set the matter billing type to MetLife before preparing a claim.' })
  }

  const planType = validPlanType(input.planType) ? input.planType : deriveMetlifePlanType(payload)
  if (planTypeIsCouple(planType) && !isCouple) {
    preflight.push({ field: 'planType', message: 'The selected couple plan conflicts with an individual matter.' })
  }
  if (!planTypeIsCouple(planType) && isCouple) {
    preflight.push({ field: 'planType', message: 'The selected individual plan conflicts with the spouse recorded on the matter.' })
  }

  const memberName = trimmed(input.memberName) ?? trimmed(payload.client.full_name)
  const spouseName = trimmed(input.spouseName) ?? trimmed(payload.spouse?.full_name)
  if (!memberName) preflight.push({ field: 'memberName', message: '[UNKNOWN] Confirm the MetLife plan member name.' })
  if (planTypeIsCouple(planType) && !spouseName) {
    preflight.push({ field: 'spouseName', message: '[UNKNOWN] Confirm the spouse name for a couple plan.' })
  }

  const memberId = trimmed(input.memberId) ?? trimmed(details.memberId)
  if (!memberId) preflight.push({ field: 'memberId', message: '[UNKNOWN] Confirm the MetLife member ID on the matter Billing tab.' })

  const serviceStart = trimmed(input.serviceStart) ?? trimmed(details.serviceStart) ?? trimmed(details.workStarted)
  const serviceEnd = trimmed(input.serviceEnd) ?? trimmed(details.serviceEnd) ?? trimmed(details.workFinished)
  if (!serviceStart) preflight.push({ field: 'serviceStart', message: '[UNKNOWN] Confirm the date the plan work started.' })
  if (!serviceEnd) preflight.push({ field: 'serviceEnd', message: '[UNKNOWN] Confirm the date the plan work finished.' })
  if (serviceStart && serviceEnd && serviceEnd < serviceStart) {
    preflight.push({ field: 'serviceEnd', message: 'The service window ends before it starts.' })
  }

  const derivedRealty = payload.documents.include_real_estate_trust || payload.documents.include_deed ? 1 : 0
  const realtyTrustCount = Number.isInteger(input.realtyTrustCount) && (input.realtyTrustCount as number) >= 0
    ? (input.realtyTrustCount as number)
    : derivedRealty
  const includeMinorGuardian = typeof input.includeMinorGuardian === 'boolean'
    ? input.includeMinorGuardian
    : Boolean(payload.documents.include_parental_appointment || payload.documents.include_temp_delegation)

  const sections = claimSections(payload, planType, memberName ?? 'Member', spouseName, realtyTrustCount, includeMinorGuardian)
  if (sections.every(entry => entry.items.length === 0)) {
    preflight.push({ field: 'documents', message: '[UNKNOWN] This matter includes no MetLife-billable documents.' })
  }

  if (preflight.length || !memberName || !memberId || !serviceStart || !serviceEnd) {
    return { data: null, preflight }
  }

  const lastNames = [payload.client.last_name, payload.spouse?.last_name].filter(Boolean) as string[]
  const filePrefix = [...new Set(lastNames.map(cleanFilenamePart))].join('-') || 'Client'

  return {
    preflight,
    data: {
      matterId: payload.matter.id,
      matterNumber: payload.matter.matter_number,
      planType,
      memberId,
      memberName,
      spouseName: planTypeIsCouple(planType) ? spouseName : null,
      serviceStart,
      serviceEnd,
      dateSubmitted: firmToday(now),
      filePrefix,
      sections,
      grandTotalCents: sections.reduce((sum, entry) => sum + entry.totalCents, 0),
      realtyTrustCount,
      includeMinorGuardian,
    },
  }
}
