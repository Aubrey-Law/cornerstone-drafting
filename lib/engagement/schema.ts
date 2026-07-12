import { agreementDefinitionFor } from './definitions'
import type {
  EngagementClientMode,
  EngagementInput,
  EngagementLegalPlan,
  EngagementPracticeArea,
  EngagementRecipientInput,
} from './types'

export type EngagementValidationResult =
  | { ok: true; value: EngagementInput }
  | { ok: false; errors: string[] }

const PRACTICE_AREAS: readonly EngagementPracticeArea[] = ['EP', 'EP-LP', 'Probate']
const CLIENT_MODES: readonly EngagementClientMode[] = ['individual', 'couple']
const LEGAL_PLANS: readonly EngagementLegalPlan[] = ['MetLife', 'LegalEase', 'ARAG']
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

export function normalizeEngagementInput(input: unknown): EngagementInput {
  const candidate = record(input)
  const fee = record(candidate.fee)

  return {
    practiceArea: candidate.practiceArea as EngagementPracticeArea,
    clientMode: candidate.clientMode as EngagementClientMode,
    agreementDate: text(candidate.agreementDate),
    primary: recipient(candidate.primary),
    spouse: candidate.spouse === null || candidate.spouse === undefined ? null : recipient(candidate.spouse),
    legalPlan: candidate.legalPlan === null || candidate.legalPlan === undefined
      ? null
      : candidate.legalPlan as EngagementLegalPlan,
    fee: { amount: fee.amount as number, paymentTerms: text(fee.paymentTerms) },
    scopeKey: text(candidate.scopeKey),
    optionalClauseKeys: Array.isArray(candidate.optionalClauseKeys)
      ? candidate.optionalClauseKeys.map(text)
      : [],
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

  if (value.practiceArea === 'EP-LP') {
    if (!value.legalPlan || !LEGAL_PLANS.includes(value.legalPlan)) errors.push('legalPlan')
  } else if (value.legalPlan !== null) {
    errors.push('legalPlan')
  }

  if (!Number.isFinite(value.fee.amount) || value.fee.amount <= 0) errors.push('fee.amount')
  if (!value.fee.paymentTerms) errors.push('fee.paymentTerms')
  if (!Number.isFinite(value.expirationHours) || value.expirationHours < 1) errors.push('expirationHours')

  if (
    Object.prototype.hasOwnProperty.call(candidate, 'optionalClauseKeys')
    && !Array.isArray(candidate.optionalClauseKeys)
  ) {
    errors.push('optionalClauseKeys')
  }

  if (PRACTICE_AREAS.includes(value.practiceArea)) {
    const definition = agreementDefinitionFor(value.practiceArea, value.legalPlan)
    if (!definition.scopeKeys.includes(value.scopeKey)) errors.push('scopeKey')
    if (value.optionalClauseKeys.some(key => !definition.optionalClauseKeys.includes(key))) {
      errors.push('optionalClauseKeys')
    }
  }

  return errors.length > 0 ? { ok: false, errors: [...new Set(errors)] } : { ok: true, value }
}
