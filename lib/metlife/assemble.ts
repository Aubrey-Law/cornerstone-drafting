import { normalizeMatterBillingType } from '@/lib/billing/billingType'
import { feeCents, SERVICE_CODE_BY_FEE, SERVICE_TYPE_BY_FEE } from '@/lib/metlife/pricing'
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
  const serviceCode = SERVICE_CODE_BY_FEE[fee]
  return {
    document,
    serviceCode,
    serviceType: SERVICE_TYPE_BY_FEE[fee],
    feeCents: feeCents(fee, rate),
    comment: `CT ${serviceCode} — ${comment}`,
  }
}

function section(title: string, items: MetlifeLineItem[]): MetlifeSection {
  return { title, items, totalCents: items.reduce((sum, item) => sum + item.feeCents, 0) }
}

function presetLine(
  document: string,
  fee: Parameters<typeof feeCents>[0],
  rate: 'member' | 'couple',
) {
  return line(document, fee, rate, document)
}

/**
 * The five estate-planning claim presets approved by the firm. Selecting (or
 * deriving) a composition auto-populates these rows in portal order. Optional
 * deed, realty-trust, and guardian-affidavit work is appended separately and
 * never changes the core package.
 */
function estatePlanningSection(planType: MetlifePlanType): MetlifeSection {
  const couple = planTypeIsCouple(planType)
  const audience = couple ? 'Member and Spouse' : 'Member'
  const rate = couple ? 'couple' : 'member'
  const items: MetlifeLineItem[] = []

  items.push(presetLine('Will with support trust/Codicil — Individual - Member', 'will', 'member'))
  if (couple) {
    items.push(presetLine('Will with support trust/Codicil — Individual - Spouse', 'will', 'member'))
  }

  items.push(presetLine(`Power of Attorney_Financial — ${audience}`, 'powerOfAttorney', rate))
  items.push(presetLine(`Power of Attorney_Health Care — ${audience}`, 'powerOfAttorney', rate))
  items.push(presetLine(`Living Will — ${audience}`, 'advancedMedicalDirective', rate))

  if (planType === 'joint_trust') {
    items.push(presetLine('Trust — Member and Spouse', 'trust', 'couple'))
  } else if (planType === 'separate_trust') {
    items.push(presetLine('Trust — Individual - Member', 'trust', 'member'))
    items.push(presetLine('Trust — Individual - Spouse', 'trust', 'member'))
  } else if (planType === 'individual_trust') {
    items.push(presetLine('Trust — Individual - Member', 'trust', 'member'))
  }

  return section('Estate Planning Claim', items)
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
  planType: MetlifePlanType,
  realtyTrustCount: number,
  includeMinorGuardian: boolean,
): MetlifeSection[] {
  const sections = [estatePlanningSection(planType)]

  if (includeMinorGuardian) {
    sections.push(section('Additional Affidavit', [
      line('Temporary Guardian Affidavit', 'affidavit', 'member', 'Temporary Guardian Affidavit for minor children'),
    ]))
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

  const sections = claimSections(planType, realtyTrustCount, includeMinorGuardian)

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
