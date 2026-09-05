import type { PromptInput } from './body'

/**
 * Every source a prompt may declare, and the column behind it.
 *
 * An allow-list rather than a dotted-path evaluator, because the alternative is
 * letting prompt content name any column in the database and reading whatever
 * it asks for. Prompt bodies will eventually be authored in a screen; the set
 * of facts a prompt can see is not something an author should be able to widen
 * by typing.
 *
 * Checked at publish time, not run time — see `unknownSources`.
 */
export const SOURCE_ALLOW_LIST: Record<string, { table: 'design_sheet' | 'matter'; column: string }> = {
  'design_sheet.concerns': { table: 'design_sheet', column: 'concerns' },
  'design_sheet.goals_notes': { table: 'design_sheet', column: 'goals_notes' },
  'design_sheet.drafting_notes': { table: 'design_sheet', column: 'drafting_notes' },
  'design_sheet.children': { table: 'design_sheet', column: 'children' },
  'design_sheet.assets': { table: 'design_sheet', column: 'assets' },
  'design_sheet.specific_bequests': { table: 'design_sheet', column: 'specific_bequests' },
  'design_sheet.disinheritances': { table: 'design_sheet', column: 'disinheritances' },
  'design_sheet.residuary_beneficiary': { table: 'design_sheet', column: 'residuary_beneficiary' },
  'design_sheet.residual_beneficiary_individuals': { table: 'design_sheet', column: 'residual_beneficiary_individuals' },
  'design_sheet.residuary_distribution': { table: 'design_sheet', column: 'residuary_distribution' },
  'design_sheet.spouse_citizenship': { table: 'design_sheet', column: 'spouse_citizenship' },
  'design_sheet.include_qdot': { table: 'design_sheet', column: 'include_qdot' },
  'design_sheet.marital_trust_type': { table: 'design_sheet', column: 'marital_trust_type' },
  'design_sheet.real_property_transfer': { table: 'design_sheet', column: 'real_property_transfer' },
  'design_sheet.state': { table: 'design_sheet', column: 'state' },
  'design_sheet.client_domicile': { table: 'design_sheet', column: 'client_domicile' },
  'design_sheet.marital_status': { table: 'design_sheet', column: 'marital_status' },
  'design_sheet.trust_name': { table: 'design_sheet', column: 'trust_name' },
  'design_sheet.plan_type': { table: 'design_sheet', column: 'plan_type' },
  'matter.name': { table: 'matter', column: 'name' },
}

export type SourceRows = {
  design_sheet: Record<string, unknown>
  matter: Record<string, unknown>
}

export type ResolvedInputs =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; missing: string[] }

/** Declared sources with no entry in the allow-list. Empty means publishable. */
export function unknownSources(declarations: PromptInput[]): string[] {
  return declarations.map(d => d.source).filter(source => !(source in SOURCE_ALLOW_LIST))
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Declared inputs, read from rows already fetched.
 *
 * Pure, with the rows passed in, following the split that has kept TS2589 out
 * of lib/auth/session.ts: the policy is a function of data, and the typed query
 * lives at the call site.
 */
export function resolveInputs(declarations: PromptInput[], rows: SourceRows): ResolvedInputs {
  const values: Record<string, unknown> = {}
  const missing: string[] = []

  for (const declaration of declarations) {
    const entry = SOURCE_ALLOW_LIST[declaration.source]
    if (!entry) {
      missing.push(declaration.source)
      continue
    }
    const value = rows[entry.table]?.[entry.column] ?? null
    if (declaration.required && isEmpty(value)) {
      missing.push(declaration.source)
      continue
    }
    values[declaration.key] = value ?? null
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, values }
}
