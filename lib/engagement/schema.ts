import { agreementDefinitionFor } from './definitions'
import { engagementTemplateFor } from './templates'
import { ENGAGEMENT_LEGAL_PLANS } from './types'
import type {
  EngagementClientMode,
  EngagementInput,
  EngagementLegalPlan,
  EngagementPracticeArea,
  EngagementRecipientInput,
  EngagementClauseSnapshot,
} from './types'

export type EngagementValidationResult =
  | { ok: true; value: EngagementInput }
  | { ok: false; errors: string[] }

const PRACTICE_AREAS: readonly EngagementPracticeArea[] = ['EP', 'EP-LP', 'Probate']
const CLIENT_MODES: readonly EngagementClientMode[] = ['individual', 'couple']
const LEGAL_PLANS: readonly EngagementLegalPlan[] = ENGAGEMENT_LEGAL_PLANS
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recipient(value: unknown): EngagementRecipientInput {
  const candidate = record(value)
  return { name: text(candidate.name), email: text(candidate.email).toLowerCase() }
}

function clauses(value: unknown): EngagementClauseSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.map(item => record(item)).map(item => ({ id: text(item.id) || null, title: text(item.title), text: text(item.text), source: ['library','ai','manual'].includes(text(item.source)) ? text(item.source) as EngagementClauseSnapshot['source'] : 'manual', aiProvenance: record(item.aiProvenance).mode ? { mode: text(record(item.aiProvenance).mode) === 'revise' ? 'revise' : 'draft', acceptedAt: text(record(item.aiProvenance).acceptedAt) } : null }))
}

export function normalizeEngagementInput(input: unknown): EngagementInput {
  const candidate = record(input)
  const fee = record(candidate.fee)

  return {
    practiceArea: candidate.practiceArea as EngagementPracticeArea,
    clientMode: candidate.clientMode as EngagementClientMode,
    agreementDate: text(candidate.agreementDate),
    primary: recipient(candidate.primary),
    spouse: candidate.spouse === null || candidate.spouse === undefined ? null : recipient(candidate.spouse),
    decedentName: text(candidate.decedentName) || null,
    legalPlan: candidate.legalPlan === null || candidate.legalPlan === undefined
      ? null
      : candidate.legalPlan as EngagementLegalPlan,
    fee: { amount: fee.amount as number, paymentTerms: text(fee.paymentTerms) },
    scopeKey: text(candidate.scopeKey),
    optionalClauseKeys: Array.isArray(candidate.optionalClauseKeys)
      ? candidate.optionalClauseKeys.map(text)
      : [],
    additionalClauses: clauses(candidate.additionalClauses),
    scheduleAClauses: clauses(candidate.scheduleAClauses),
    emailMessage: text(candidate.emailMessage),
    expirationHours: candidate.expirationHours as number,
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function validateEngagementInput(input: unknown): EngagementValidationResult {
  const candidate = record(input)
  const value = normalizeEngagementInput(input)
  const template = engagementTemplateFor(value)
  const errors: string[] = []

  if (!PRACTICE_AREAS.includes(value.practiceArea)) errors.push('practiceArea')
  if (!CLIENT_MODES.includes(value.clientMode)) errors.push('clientMode')
  if (!isIsoDate(value.agreementDate)) errors.push('agreementDate')
  if (!value.primary.name) errors.push('primary.name')
  if (!EMAIL_PATTERN.test(value.primary.email)) errors.push('primary.email')

  if (value.clientMode === 'couple') {
    if (!value.spouse) errors.push('spouse')
    else {
      if (!value.spouse.name) errors.push('spouse.name')
      if (!EMAIL_PATTERN.test(value.spouse.email)) errors.push('spouse.email')
    }
  } else if (value.spouse !== null) {
    errors.push('spouse')
  }

  // Only a master that prints an "Estate of" line has anywhere to put a
  // decedent, so one supplied to any other master is rejected rather than
  // carried in a snapshot nothing renders.
  if (template?.namesDecedent) {
    if (!value.decedentName) errors.push('decedentName')
  } else if (value.decedentName !== null) {
    errors.push('decedentName')
  }

  if (value.practiceArea === 'EP-LP') {
    if (!value.legalPlan || !LEGAL_PLANS.includes(value.legalPlan)) errors.push('legalPlan')
  } else if (value.legalPlan !== null) {
    errors.push('legalPlan')
  }

  // A plan-funded agreement states no firm fee of its own, so it is not asked
  // for one. An agreement that prints its own payment schedule asks for the
  // amount alone: free-text terms have nowhere to render in it.
  const firmFee = template?.firmFee ?? 'amount_and_terms'
  if (!Number.isFinite(value.fee.amount) || value.fee.amount < 0) errors.push('fee.amount')
  else if (firmFee !== 'none' && value.fee.amount <= 0) errors.push('fee.amount')
  if (firmFee === 'amount_and_terms' && !value.fee.paymentTerms) errors.push('fee.paymentTerms')
  if (!Number.isFinite(value.expirationHours) || value.expirationHours < 1) errors.push('expirationHours')

  if (
    Object.prototype.hasOwnProperty.call(candidate, 'optionalClauseKeys')
    && !Array.isArray(candidate.optionalClauseKeys)
  ) {
    errors.push('optionalClauseKeys')
  }
  if ([...(value.additionalClauses ?? []), ...(value.scheduleAClauses ?? [])].some(clause => !clause.title || !clause.text)) errors.push('clauses')

  if (PRACTICE_AREAS.includes(value.practiceArea)) {
    const definition = agreementDefinitionFor(value.practiceArea, value.legalPlan)
    if (!definition.scopeKeys.includes(value.scopeKey)) errors.push('scopeKey')
    // Only the master that prints the addendum can say which services it
    // offers, so an election it does not list is rejected here rather than
    // silently dropped at render.
    const offered = template?.optionalServiceKeys ?? []
    if (value.optionalClauseKeys.some(key => !offered.includes(key))) {
      errors.push('optionalClauseKeys')
    }
    // Same rule for Schedule A: a master that does not print the loop would
    // drop these clauses silently, so they are refused instead.
    if (template && !template.printsScheduleAClauses && (value.scheduleAClauses ?? []).length > 0) {
      errors.push('scheduleAClauses')
    }
  }

  return errors.length > 0 ? { ok: false, errors: [...new Set(errors)] } : { ok: true, value }
}
