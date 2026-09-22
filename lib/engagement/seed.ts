import { normalizeMatterBillingType } from '@/lib/billing/billingType'
import { parsePracticeArea } from '@/lib/practiceArea'
import { engagementTemplateFor } from './templates'
import { ENGAGEMENT_LEGAL_PLANS, type EngagementClientMode, type EngagementLegalPlan, type EngagementPracticeArea } from './types'

/**
 * The plan an LP engagement names, or null when the record names none.
 *
 * `billing_type` is the firm's one answer to "who pays" on both a lead and a
 * matter, so the engagement reads it rather than asking again — which is also
 * why an LP record billed as flat fee, or as an unnamed plan, resolves to null
 * here instead of guessing a carrier into the client's letter.
 */
export function engagementLegalPlanFrom(billingType: unknown): EngagementLegalPlan | null {
  const normalized = normalizeMatterBillingType(billingType)
  if (!normalized) return null
  return (ENGAGEMENT_LEGAL_PLANS as readonly string[]).includes(normalized)
    ? normalized as EngagementLegalPlan
    : null
}

export interface EngagementSeedRecord {
  practiceArea: unknown
  billingType: unknown
  spouseEmail: string | null | undefined
  /** The estate's decedent, for a probate record. */
  decedentName?: string | null
}

export interface EngagementSeedDefinition {
  practiceArea: EngagementPracticeArea
  clientMode: EngagementClientMode
  scopeKey: 'standard'
  legalPlan: EngagementLegalPlan | null
}

export type EngagementSeedResult =
  /**
   * `spouseEmail` is the checked one, so the caller does not re-check it. It is
   * null for a solo client, whose agreement has no second signer.
   *
   * `decedentName` is null unless the chosen master names one, so a caller can
   * put it straight into the draft without asking which practice area this is.
   */
  | { ok: true; definition: EngagementSeedDefinition; spouseEmail: string | null; decedentName: string | null }
  | { ok: false; error: string }

/**
 * What to seed a new draft with, or why this record cannot have one.
 *
 * The answer is whatever `engagementTemplateFor` covers, so adding a master is
 * all it takes for a record to become draftable — the routes do not carry their
 * own list of supported combinations.
 */
export function engagementSeedDefinition(record: EngagementSeedRecord): EngagementSeedResult {
  const practiceArea = parsePracticeArea(record.practiceArea)
  if (practiceArea !== 'EP' && practiceArea !== 'EP-LP' && practiceArea !== 'Probate') {
    return { ok: false, error: 'The reviewed workspace does not cover this practice area; use the legacy engagement flow.' }
  }
  const legalPlan = practiceArea === 'EP-LP' ? engagementLegalPlanFrom(record.billingType) : null
  if (practiceArea === 'EP-LP' && !legalPlan) {
    return {
      ok: false,
      // The letter names the plan in its coverage paragraph, so it cannot be
      // drafted before someone has said which plan this is.
      error: 'Set the legal plan on this record before drafting an Estate Planning - LP engagement letter.',
    }
  }
  // A spouse on the record is what makes this a couple. Whether that has a
  // master is the table's answer, not a second rule here — and probate is
  // always the personal representative alone, which is why the spouse on a
  // probate record (a surviving spouse is common) does not make it a couple.
  const spouseEmail = practiceArea === 'Probate' ? null : record.spouseEmail || null
  const clientMode: EngagementClientMode = spouseEmail ? 'couple' : 'individual'
  const definition = { practiceArea, clientMode, scopeKey: 'standard' as const, legalPlan }
  // Every combination the practice areas above allow has a master today, so
  // this guard is what keeps `ok: true` meaning "a master exists" if one is
  // ever withdrawn.
  const template = engagementTemplateFor(definition)
  if (!template) {
    return { ok: false, error: 'No engagement master covers this combination; use the legacy engagement flow.' }
  }
  const decedentName = template.namesDecedent ? (record.decedentName || '').trim() : ''
  if (template.namesDecedent && !decedentName) {
    return {
      ok: false,
      // The agreement is addressed "Estate of —" and describes the scope of the
      // administration by it, so it cannot be drafted before the estate is named.
      error: 'Set the decedent name on this matter before drafting a probate engagement agreement.',
    }
  }
  return { ok: true, definition, spouseEmail, decedentName: decedentName || null }
}
