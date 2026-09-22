import { ENGAGEMENT_LEGAL_PLANS } from './types'
import type { EngagementClientMode, EngagementLegalPlan, EngagementPracticeArea } from './types'

/**
 * Which master document a given engagement definition renders from.
 *
 * One table, because three callers have to agree on it: the renderer picks the
 * file, the document-template registry exposes the same file for an override
 * upload, and the drafting workspace decides from it whether a definition can
 * be drafted at all. When those disagreed there was only one template, so it
 * did not show; a second one makes the disagreement a wrong agreement sent to a
 * client.
 */
export interface EngagementTemplate {
  /** Registry id — `lib/documentTemplates/registry.ts`, and the override key. */
  templateId: string
  /** Stored on every revision as the master this agreement came from. */
  masterKey: string
  /** Version of the bundled master; a resolved override supplies its own. */
  masterVersion: string
  label: string
  bundledPath: string
  practiceArea: EngagementPracticeArea
  clientMode: EngagementClientMode
  scopeKey: string
  /**
   * Plans this template names in its own prose, or null for a template that
   * names none. A definition matches only if its plan is in this list, so a
   * plan-funded engagement can never render from the flat-fee master.
   */
  legalPlans: readonly EngagementLegalPlan[] | null
  /** Signers in agreement order, which fixes the anchors the master carries. */
  recipientCount: number
  /**
   * Optional services this master's addendum prints, keyed into
   * `OPTIONAL_SERVICES`. A service missing here cannot be elected on this
   * agreement, because the row the client would read is not in the document.
   */
  optionalServiceKeys: readonly string[]
  /**
   * Whether the master states the firm's own fee and payment terms.
   *
   * A plan-funded letter does not: its Schedule A says the fee is whatever the
   * plan's attorney fee schedule pays, so a flat fee and payment terms are not
   * fields of that agreement and are not required to draft one.
   */
  statesFirmFee: boolean
}

export const ENGAGEMENT_TEMPLATES: readonly EngagementTemplate[] = [
  {
    templateId: 'engagement-ep-trust-couple',
    masterKey: 'ep-trust-couple',
    masterVersion: '1',
    label: 'Engagement Agreement — Estate Plan Trust Couple',
    bundledPath: 'assets/engagement-agreements/ep-trust-couple-v1.docx',
    practiceArea: 'EP',
    clientMode: 'couple',
    scopeKey: 'standard',
    legalPlans: null,
    recipientCount: 2,
    optionalServiceKeys: [],
    statesFirmFee: true,
  },
  {
    templateId: 'engagement-ep-trust-individual',
    masterKey: 'ep-trust-individual',
    masterVersion: '1',
    label: 'Engagement Agreement — Estate Plan Trust Individual',
    bundledPath: 'assets/engagement-agreements/ep-trust-individual-v1.docx',
    practiceArea: 'EP',
    clientMode: 'individual',
    scopeKey: 'standard',
    legalPlans: null,
    recipientCount: 1,
    optionalServiceKeys: [],
    statesFirmFee: true,
  },
  {
    templateId: 'engagement-ep-lp-trust-couple',
    masterKey: 'ep-lp-trust-couple',
    masterVersion: '1',
    label: 'Engagement Letter — Estate Plan Trust Couple (Legal Plan)',
    bundledPath: 'assets/engagement-agreements/ep-lp-trust-couple-v1.docx',
    practiceArea: 'EP-LP',
    clientMode: 'couple',
    scopeKey: 'standard',
    legalPlans: ENGAGEMENT_LEGAL_PLANS,
    recipientCount: 2,
    optionalServiceKeys: ['credit_shelter_planning', 'deed_recording'],
    statesFirmFee: false,
  },
  {
    templateId: 'engagement-ep-lp-trust-individual',
    masterKey: 'ep-lp-trust-individual',
    masterVersion: '1',
    label: 'Engagement Letter — Estate Plan Trust Individual (Legal Plan)',
    bundledPath: 'assets/engagement-agreements/ep-lp-trust-individual-v1.docx',
    practiceArea: 'EP-LP',
    clientMode: 'individual',
    scopeKey: 'standard',
    legalPlans: ENGAGEMENT_LEGAL_PLANS,
    recipientCount: 1,
    // Credit shelter planning preserves both spouses' Massachusetts
    // exemptions, so the solo letter's addendum does not print that row.
    optionalServiceKeys: ['deed_recording'],
    statesFirmFee: false,
  },
]

export interface EngagementTemplateSelector {
  practiceArea?: string | null
  clientMode?: string | null
  scopeKey?: string | null
  legalPlan?: unknown
}

/** The master for this definition, or null when nothing covers it yet. */
export function engagementTemplateFor(selector: EngagementTemplateSelector): EngagementTemplate | null {
  const plan = selector.legalPlan ?? null
  return ENGAGEMENT_TEMPLATES.find(template =>
    template.practiceArea === selector.practiceArea
    && template.clientMode === selector.clientMode
    && template.scopeKey === selector.scopeKey
    && (template.legalPlans === null
      ? plan === null
      : typeof plan === 'string' && (template.legalPlans as readonly string[]).includes(plan)),
  ) ?? null
}

export function engagementTemplateById(templateId: string): EngagementTemplate | null {
  return ENGAGEMENT_TEMPLATES.find(template => template.templateId === templateId) ?? null
}
