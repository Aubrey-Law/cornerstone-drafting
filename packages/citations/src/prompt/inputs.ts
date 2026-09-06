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
  // Name-bearing fiduciary fields. A check asking whether a person named in
  // free text appears "in the plan" was, until now, shown none of these — the
  // only fields where a fiduciary appointment is actually recorded as a name
  // a model can quote. The `*_slots` fields (see designSheet.ts) hold contact
  // references, not names, and are declared separately once resolved.
  'design_sheet.guardian_primary': { table: 'design_sheet', column: 'guardian_primary' },
  'design_sheet.guardian_alt1': { table: 'design_sheet', column: 'guardian_alt1' },
  'design_sheet.trustee_primary': { table: 'design_sheet', column: 'trustee_primary' },
  'design_sheet.trustee_alt1': { table: 'design_sheet', column: 'trustee_alt1' },
  'design_sheet.executor_primary': { table: 'design_sheet', column: 'executor_primary' },
  'design_sheet.hcp_primary': { table: 'design_sheet', column: 'hcp_primary' },
  'design_sheet.poa_primary': { table: 'design_sheet', column: 'poa_primary' },
  'design_sheet.spouse_name': { table: 'design_sheet', column: 'spouse_name' },
  'design_sheet.client_name': { table: 'design_sheet', column: 'client_name' },
  // As stored, each of these is `[{id, is_co, order, contact_id}]` -- a
  // contact_id is a foreign key, not a fact a model can quote. The app layer
  // (designSheet.ts's loadSourceRows) resolves every entry to `{ order,
  // is_co, name }` before a prompt ever sees this column; the package itself
  // has no database to resolve one against.
  'design_sheet.guardian_slots': { table: 'design_sheet', column: 'guardian_slots' },
  'design_sheet.temporary_guardian_slots': { table: 'design_sheet', column: 'temporary_guardian_slots' },
  'design_sheet.trustee_slots': { table: 'design_sheet', column: 'trustee_slots' },
  'design_sheet.executor_slots': { table: 'design_sheet', column: 'executor_slots' },
  'design_sheet.hcp_slots': { table: 'design_sheet', column: 'hcp_slots' },
  'design_sheet.poa_slots': { table: 'design_sheet', column: 'poa_slots' },
  'matter.name': { table: 'matter', column: 'name' },
}

export type SourceRows = {
  design_sheet: Record<string, unknown>
  matter: Record<string, unknown>
}

/**
 * `missing` and `unresolvable` look like the same failure — a value the prompt
 * needed isn't there — but this codebase has already shipped five features
 * querying `matters.title`, a column that never existed, so "the path is
 * wrong" and "the field is blank" cannot share a bucket. `missing` is a design
 * sheet a person can finish filling in. `unresolvable` is a path whose column
 * was allow-listed at publish time and has since gone stale — typing will
 * never fix it, and a caller that can't tell the two apart would send an
 * attorney to go complete a field that no longer exists.
 */
export type ResolvedInputs =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; missing: string[]; unresolvable: string[] }

/** Declared sources with no entry in the allow-list. Empty means publishable. */
export function unknownSources(declarations: PromptInput[]): string[] {
  return declarations.map(d => d.source).filter(source => !(source in SOURCE_ALLOW_LIST))
}

// `{}`, `0`, and `false` are answers, not absence — deliberately not treated as
// empty here. That's only correct because these jsonb columns are initialised
// to `[]` or `null`, never `{}` (see how design sheets are built in the root
// app); if a boolean column joins the allow-list, don't "fix" this to catch
// `false` too.
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
  const unresolvable: string[] = []

  for (const declaration of declarations) {
    const entry = SOURCE_ALLOW_LIST[declaration.source]
    if (!entry) {
      // Ignores `declaration.required`: an optional input pointing at a
      // vanished column is still a broken prompt, just a quieter one.
      unresolvable.push(declaration.source)
      continue
    }
    const value = rows[entry.table]?.[entry.column] ?? null
    if (declaration.required && isEmpty(value)) {
      missing.push(declaration.source)
      continue
    }
    values[declaration.key] = value
  }

  return missing.length > 0 || unresolvable.length > 0
    ? { ok: false, missing, unresolvable }
    : { ok: true, values }
}
