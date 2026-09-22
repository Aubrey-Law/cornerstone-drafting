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
   * What the master prints of the firm's own fee, and therefore requires.
   *
   * - `none`: a plan-funded letter, whose Schedule A says the fee is whatever
   *   the plan's attorney fee schedule pays. Neither field is asked for.
   * - `amount`: the agreement states a fee and prints its own schedule for
   *   paying it, so there is nowhere for free-text terms to render.
   * - `amount_and_terms`: the agreement prints both.
   */
  firmFee: 'none' | 'amount' | 'amount_and_terms'
  /**
   * Whether the master divides its fee into the firm's probate phases, which
   * the renderer computes from the total rather than asking for three more
   * numbers that have to add up — see `PROBATE_PHASE_SHARES`.
   */
  phasesFee?: boolean
  /** Whether the master names a decedent, which only a probate matter has. */
  namesDecedent?: boolean
  /**
   * Whether the master prints the Schedule A clause loop. A master that does
   * not has nowhere to render those clauses, so electing them is rejected
   * rather than silently dropped — the same rule as its optional services.
   */
  printsScheduleAClauses: boolean
}

/**
 * How a probate flat fee divides across the phases the agreement bills in.
 *
 * The firm's executed agreements split it exactly this way, and the master
 * prints all four amounts, so the split lives here rather than in three fields
 * staff would have to keep adding up to the total.
 */
export const PROBATE_PHASE_SHARES = { opening: 0.5, inventory: 0.25, final_account: 0.25 } as const

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
    firmFee: 'amount_and_terms',
    printsScheduleAClauses: true,
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
    firmFee: 'amount_and_terms',
    printsScheduleAClauses: true,
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
    firmFee: 'none',
    printsScheduleAClauses: true,
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
    firmFee: 'none',
    printsScheduleAClauses: true,
  },
  {
    templateId: 'engagement-probate-individual',
    masterKey: 'probate-individual',
    masterVersion: '1',
    label: 'Engagement Agreement — Probate Administration',
    bundledPath: 'assets/engagement-agreements/probate-individual-v1.docx',
    practiceArea: 'Probate',
    // The personal representative engages the firm and signs alone; the
    // agreement has one signature block, whoever else may inherit.
    clientMode: 'individual',
    scopeKey: 'standard',
    legalPlans: null,
    recipientCount: 1,
    optionalServiceKeys: [],
    // It states a flat fee and prints the phase schedule for paying it.
    firmFee: 'amount',
    phasesFee: true,
    namesDecedent: true,
    // Its terms are the agreement's own numbered sections; there is no
    // Schedule A to append clauses to.
    printsScheduleAClauses: false,
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
