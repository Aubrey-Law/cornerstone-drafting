import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface WillPersonalRepresentativePowers {
  allow_pay_taxes_debts_expenses: boolean
  allow_manage_digital_assets: boolean
  include_distribution_cash_or_kind: boolean
}

const DEFAULT_WILL_PR_POWERS: WillPersonalRepresentativePowers = {
  allow_pay_taxes_debts_expenses: false,
  allow_manage_digital_assets: false,
  include_distribution_cash_or_kind: false,
}

function willPowersRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.will_pr_powers
  return isRecord(raw) ? raw : {}
}

function readBoolean(raw: Record<string, unknown>, key: keyof WillPersonalRepresentativePowers): boolean {
  return typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_WILL_PR_POWERS[key]
}

export function getWillPersonalRepresentativePowers(
  sheet: Pick<DesignSheet, 'decisions'>,
): WillPersonalRepresentativePowers {
  const raw = willPowersRaw(sheet)
  return {
    allow_pay_taxes_debts_expenses: readBoolean(raw, 'allow_pay_taxes_debts_expenses'),
    allow_manage_digital_assets: readBoolean(raw, 'allow_manage_digital_assets'),
    include_distribution_cash_or_kind: readBoolean(raw, 'include_distribution_cash_or_kind'),
  }
}

export function setWillPersonalRepresentativePowers(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<WillPersonalRepresentativePowers>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = getWillPersonalRepresentativePowers(sheet)

  return {
    ...decisions,
    will_pr_powers: {
      ...current,
      ...patch,
    },
  }
}
