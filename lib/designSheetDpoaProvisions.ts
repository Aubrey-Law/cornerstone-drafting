import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type DpoaAgentCompensation = 'prevailing_professional' | 'reasonable' | 'none'
export type DpoaCoagentServing = 'jointly' | 'separately' | 'silent'

export const DPOA_BASIC_POWER_KEYS = [
  'real_property',
  'tangible_personal_property',
  'stocks_bonds',
  'commodities_options',
  'banking',
  'business_operating',
  'insurance_annuity',
  'estate_trust_beneficiary',
  'claims_litigation',
  'personal_family_maintenance',
  'government_benefits',
  'retirement_plans',
  'tax_matters',
] as const

export type DpoaBasicPowerKey = (typeof DPOA_BASIC_POWER_KEYS)[number]

export const DPOA_TRUST_POWER_KEYS = [
  'agent_may_create_trusts',
  'agent_may_create_trusts_for_dependents',
  'allow_agent_as_trustee',
  'agent_may_create_medicaid_trusts',
  'agent_may_modify_sole_settlor_trusts',
  'agent_may_modify_joint_trusts',
] as const

export type DpoaTrustPowerKey = (typeof DPOA_TRUST_POWER_KEYS)[number]

export const DPOA_BASIC_POWER_LABELS: Record<DpoaBasicPowerKey, string> = {
  real_property: 'Real property transactions',
  tangible_personal_property: 'Tangible personal property transactions',
  stocks_bonds: 'Stock and bond transactions',
  commodities_options: 'Commodity and option transactions',
  banking: 'Banking and other financial institution transactions',
  business_operating: 'Business operating transactions',
  insurance_annuity: 'Insurance and annuity transactions',
  estate_trust_beneficiary: 'Estate, trust, and other beneficiary transactions',
  claims_litigation: 'Claims and litigation',
  personal_family_maintenance: 'Personal and family maintenance',
  government_benefits: 'Benefits from Social Security, Medicare, Medicaid, or other governmental programs, or civil or military service',
  retirement_plans: 'Retirement plan transactions',
  tax_matters: 'Tax matters',
}

export interface DesignSheetDpoaProvisions {
  include_entity_powers: boolean
  include_advanced_trust_gifting: boolean
  include_extended_personal_care: boolean
  agent_compensation: DpoaAgentCompensation | null
  coagent_serving: DpoaCoagentServing | null
  allow_gifts: boolean
  include_trust_powers: boolean
  agent_may_create_trusts: boolean
  agent_may_create_trusts_for_dependents: boolean
  allow_agent_as_trustee: boolean
  agent_may_create_medicaid_trusts: boolean
  agent_may_modify_sole_settlor_trusts: boolean
  agent_may_modify_joint_trusts: boolean
  allow_delegation: boolean
  prohibit_arbitration: boolean
  power_529_plans: boolean
  allow_medical_information_access: boolean
  power_digital_assets: boolean
  allow_self_designation_beneficiary: boolean
  all_basic_powers: boolean
  basic_powers: Record<DpoaBasicPowerKey, boolean>
  additional_powers: string | null
  specific_businesses: string | null
  additional_limitations: string | null
}

const DEFAULT_BASIC_POWERS = Object.fromEntries(
  DPOA_BASIC_POWER_KEYS.map(key => [key, false]),
) as Record<DpoaBasicPowerKey, boolean>

const DEFAULT_DPOA_PROVISIONS: DesignSheetDpoaProvisions = {
  include_entity_powers: false,
  include_advanced_trust_gifting: false,
  include_extended_personal_care: false,
  agent_compensation: 'reasonable',
  coagent_serving: 'separately',
  allow_gifts: false,
  include_trust_powers: false,
  agent_may_create_trusts: false,
  agent_may_create_trusts_for_dependents: false,
  allow_agent_as_trustee: false,
  agent_may_create_medicaid_trusts: false,
  agent_may_modify_sole_settlor_trusts: false,
  agent_may_modify_joint_trusts: false,
  allow_delegation: false,
  prohibit_arbitration: false,
  power_529_plans: false,
  allow_medical_information_access: false,
  power_digital_assets: false,
  allow_self_designation_beneficiary: false,
  all_basic_powers: false,
  basic_powers: { ...DEFAULT_BASIC_POWERS },
  additional_powers: null,
  specific_businesses: null,
  additional_limitations: null,
}

function dpoaProvisionsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.dpoa_provisions
  return isRecord(raw) ? raw : {}
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof raw[key] === 'boolean' ? raw[key] : fallback
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readCompensation(raw: Record<string, unknown>): DpoaAgentCompensation | null {
  const value = raw.agent_compensation
  if (value === 'prevailing_professional' || value === 'reasonable' || value === 'none') return value
  return DEFAULT_DPOA_PROVISIONS.agent_compensation
}

function readCoagentServing(raw: Record<string, unknown>): DpoaCoagentServing | null {
  const value = raw.coagent_serving
  if (value === 'jointly' || value === 'separately' || value === 'silent') return value
  return null
}

function readBasicPowers(raw: Record<string, unknown>): Record<DpoaBasicPowerKey, boolean> {
  const scoped = isRecord(raw.basic_powers) ? raw.basic_powers : {}
  return DPOA_BASIC_POWER_KEYS.reduce((acc, key) => {
    acc[key] = typeof scoped[key] === 'boolean' ? scoped[key] : DEFAULT_BASIC_POWERS[key]
    return acc
  }, {} as Record<DpoaBasicPowerKey, boolean>)
}

function coagentServingFromLegacyManner(
  manner: string | null | undefined,
): DpoaCoagentServing {
  if (manner === 'jointly') return 'jointly'
  if (manner === 'independently') return 'separately'
  return 'silent'
}

/**
 * Whether the client actually recorded these decisions. The getters above
 * supply working defaults ('reasonable', legacy-manner fallback) so documents
 * can render, which means readiness cannot use them to ask "was this decided?"
 * — the defaulted value is always truthy and the blocker would never fire.
 */
export function dpoaCompensationDecided(sheet: Pick<DesignSheet, 'decisions'>): boolean {
  const value = dpoaProvisionsRaw(sheet).agent_compensation
  return value === 'prevailing_professional' || value === 'reasonable' || value === 'none'
}

export function dpoaCoagentServingDecided(sheet: DpoaProvisionsSheet): boolean {
  const value = dpoaProvisionsRaw(sheet).coagent_serving
  if (value === 'jointly' || value === 'separately' || value === 'silent') return true
  return sheet.dpoa_coagent_manner === 'jointly' || sheet.dpoa_coagent_manner === 'independently'
}

export function coagentMannerFromServing(serving: DpoaCoagentServing | null): DesignSheet['dpoa_coagent_manner'] {
  if (serving === 'jointly') return 'jointly'
  if (serving === 'separately') return 'independently'
  return null
}

type DpoaProvisionsSheet = Pick<DesignSheet, 'decisions'> & {
  dpoa_coagent_manner?: string | null
}

export function getDesignSheetDpoaProvisions(
  sheet: DpoaProvisionsSheet,
): DesignSheetDpoaProvisions {
  const raw = dpoaProvisionsRaw(sheet)
  const basicPowers = readBasicPowers(raw)
  const allBasicPowers = readBoolean(raw, 'all_basic_powers', DPOA_BASIC_POWER_KEYS.every(key => basicPowers[key]))
  // Sheets saved before the include/don't-include choice existed only recorded the
  // individual switches, so treat any checked trust power as an earlier "include".
  const includeTrustPowers = readBoolean(raw, 'include_trust_powers', DPOA_TRUST_POWER_KEYS.some(key => raw[key] === true))

  return {
    include_entity_powers: readBoolean(raw, 'include_entity_powers', DEFAULT_DPOA_PROVISIONS.include_entity_powers),
    include_advanced_trust_gifting: readBoolean(raw, 'include_advanced_trust_gifting', DEFAULT_DPOA_PROVISIONS.include_advanced_trust_gifting),
    include_extended_personal_care: readBoolean(raw, 'include_extended_personal_care', DEFAULT_DPOA_PROVISIONS.include_extended_personal_care),
    agent_compensation: readCompensation(raw),
    coagent_serving: readCoagentServing(raw) ?? coagentServingFromLegacyManner(sheet.dpoa_coagent_manner),
    allow_gifts: readBoolean(raw, 'allow_gifts', DEFAULT_DPOA_PROVISIONS.allow_gifts),
    include_trust_powers: includeTrustPowers,
    agent_may_create_trusts: readBoolean(raw, 'agent_may_create_trusts', DEFAULT_DPOA_PROVISIONS.agent_may_create_trusts),
    agent_may_create_trusts_for_dependents: readBoolean(raw, 'agent_may_create_trusts_for_dependents', DEFAULT_DPOA_PROVISIONS.agent_may_create_trusts_for_dependents),
    allow_agent_as_trustee: readBoolean(raw, 'allow_agent_as_trustee', DEFAULT_DPOA_PROVISIONS.allow_agent_as_trustee),
    agent_may_create_medicaid_trusts: readBoolean(raw, 'agent_may_create_medicaid_trusts', DEFAULT_DPOA_PROVISIONS.agent_may_create_medicaid_trusts),
    agent_may_modify_sole_settlor_trusts: readBoolean(raw, 'agent_may_modify_sole_settlor_trusts', DEFAULT_DPOA_PROVISIONS.agent_may_modify_sole_settlor_trusts),
    agent_may_modify_joint_trusts: readBoolean(raw, 'agent_may_modify_joint_trusts', DEFAULT_DPOA_PROVISIONS.agent_may_modify_joint_trusts),
    allow_delegation: readBoolean(raw, 'allow_delegation', DEFAULT_DPOA_PROVISIONS.allow_delegation),
    prohibit_arbitration: readBoolean(raw, 'prohibit_arbitration', DEFAULT_DPOA_PROVISIONS.prohibit_arbitration),
    power_529_plans: readBoolean(raw, 'power_529_plans', DEFAULT_DPOA_PROVISIONS.power_529_plans),
    allow_medical_information_access: readBoolean(raw, 'allow_medical_information_access', DEFAULT_DPOA_PROVISIONS.allow_medical_information_access),
    power_digital_assets: readBoolean(raw, 'power_digital_assets', DEFAULT_DPOA_PROVISIONS.power_digital_assets),
    allow_self_designation_beneficiary: readBoolean(raw, 'allow_self_designation_beneficiary', DEFAULT_DPOA_PROVISIONS.allow_self_designation_beneficiary),
    all_basic_powers: allBasicPowers,
    basic_powers: allBasicPowers
      ? Object.fromEntries(DPOA_BASIC_POWER_KEYS.map(key => [key, true])) as Record<DpoaBasicPowerKey, boolean>
      : basicPowers,
    additional_powers: readString(raw, 'additional_powers'),
    specific_businesses: readString(raw, 'specific_businesses'),
    additional_limitations: readString(raw, 'additional_limitations'),
  }
}

/**
 * Trust powers as the drafted document should see them: every switch is off unless
 * the attorney chose to include trust powers, so a later "do not include" wins over
 * selections made earlier.
 */
export function effectiveDpoaTrustPowers(
  provisions: DesignSheetDpoaProvisions,
): Record<DpoaTrustPowerKey, boolean> {
  return DPOA_TRUST_POWER_KEYS.reduce((acc, key) => {
    acc[key] = provisions.include_trust_powers ? provisions[key] : false
    return acc
  }, {} as Record<DpoaTrustPowerKey, boolean>)
}

export function setDesignSheetDpoaProvisions(
  sheet: DpoaProvisionsSheet,
  patch: Partial<DesignSheetDpoaProvisions>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = getDesignSheetDpoaProvisions(sheet)
  const next = { ...current, ...patch }

  if (patch.all_basic_powers === true) {
    next.basic_powers = Object.fromEntries(
      DPOA_BASIC_POWER_KEYS.map(key => [key, true]),
    ) as Record<DpoaBasicPowerKey, boolean>
  }

  if (patch.basic_powers) {
    next.all_basic_powers = DPOA_BASIC_POWER_KEYS.every(key => next.basic_powers[key])
  }

  return {
    ...decisions,
    dpoa_provisions: next,
  }
}
