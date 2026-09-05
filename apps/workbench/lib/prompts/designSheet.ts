import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { SOURCE_ALLOW_LIST, type SourceRows } from '@aubrey-law/citations/prompt/inputs'

/**
 * Every design_sheet / matter column `SOURCE_ALLOW_LIST` can ever ask a
 * prompt to read, computed from the allow-list itself rather than counted by
 * hand — so a source added there and forgotten here does not resolve every
 * declaration against it to `null`, indistinguishable from a genuinely empty
 * field. That is the exact failure mode `resolveInputs`'s own header comment
 * warns about, one layer up: nothing there stops a caller from handing it
 * rows that quietly don't carry a column it was told to trust.
 */
const DESIGN_SHEET_COLUMNS = Object.values(SOURCE_ALLOW_LIST)
  .filter((entry) => entry.table === 'design_sheet')
  .map((entry) => entry.column)

const MATTER_COLUMNS = Object.values(SOURCE_ALLOW_LIST)
  .filter((entry) => entry.table === 'matter')
  .map((entry) => entry.column)

/**
 * The actual `.select(...)` arguments, kept as literal strings rather than
 * built from the arrays above at call time.
 *
 * This codebase's offline column safety net — tests/query-columns.test.ts and
 * scripts/checkDbColumns.mjs — can only see a column name written as a string
 * literal in a `.select(...)` call, or a same-file `const NAME = '...'` (see
 * `stringConstants` in scripts/lib/queryReferences.mjs; `lib/funding/repository.ts`'s
 * `ASSET_SELECT` is the same pattern already in this codebase). A select
 * string assembled at runtime from `SOURCE_ALLOW_LIST` would run correctly
 * and be invisible to both checks — exactly the blind spot that let five
 * features ship reading `matters.title`, a column that has never existed.
 * `assertSelectMatches` below is what keeps these two literals from silently
 * drifting out of step with the allow-list they are supposed to mirror,
 * without giving up what makes them checkable in the first place.
 */
// One unbroken string literal, not a concatenation: `stringConstants` in
// scripts/lib/queryReferences.mjs only recognises a `const` whose initializer
// is itself a single string-literal AST node — a `'...' + '...'` join is a
// binary expression and would be invisible to it just the same as a runtime
// `.join(', ')` would be.
const DESIGN_SHEET_SELECT = 'concerns, goals_notes, drafting_notes, children, assets, specific_bequests, disinheritances, residuary_beneficiary, residual_beneficiary_individuals, residuary_distribution, spouse_citizenship, include_qdot, marital_trust_type, real_property_transfer, state, client_domicile, marital_status, trust_name, plan_type'

const MATTER_SELECT = 'name'

function assertSelectMatches(label: string, select: string, derived: string[]): void {
  const literal = [...new Set(select.split(',').map((column) => column.trim()))].sort()
  const expected = [...new Set(derived)].sort()
  if (JSON.stringify(literal) !== JSON.stringify(expected)) {
    throw new Error(
      `designSheet.ts's ${label} select has drifted from SOURCE_ALLOW_LIST. ` +
        `Literal: [${literal.join(', ')}]. Expected: [${expected.join(', ')}].`,
    )
  }
}

assertSelectMatches('design_sheet', DESIGN_SHEET_SELECT, DESIGN_SHEET_COLUMNS)
assertSelectMatches('matter', MATTER_SELECT, MATTER_COLUMNS)

/**
 * The matter and its latest design sheet, read as exactly the columns a
 * field-audit prompt is ever allowed to reference.
 *
 * Null when the matter does not exist, or exists but has no design sheet yet
 * — an audit has nothing to run against either way, and the caller is better
 * placed than this function to decide what to say about that.
 */
export async function loadSourceRows(
  client: SupabaseClient<WorkbenchDatabase>,
  matterId: string,
): Promise<SourceRows | null> {
  const sb = client

  const [{ data: matterRow, error: matterError }, { data: sheetRow, error: sheetError }] = await Promise.all([
    sb.from('matters').select(MATTER_SELECT).eq('id', matterId).maybeSingle(),
    sb
      .from('design_sheets')
      .select(DESIGN_SHEET_SELECT)
      .eq('matter_id', matterId)
      // `design_sheets.version`: a matter can be restated, and the highest
      // version on file is the current sheet — the same ordering
      // `loadGateContext` in lib/stage-engine/fireStageTasks.ts already uses.
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (matterError) throw new Error(`Could not load the matter: ${matterError.message}`)
  if (sheetError) throw new Error(`Could not load the design sheet: ${sheetError.message}`)
  if (!matterRow || !sheetRow) return null

  return {
    design_sheet: sheetRow as Record<string, unknown>,
    matter: matterRow as Record<string, unknown>,
  }
}

export interface MatterOption {
  matterId: string
  title: string
}

/**
 * Every matter that has a design sheet at all — the set a field audit could
 * conceivably run against, for the `/prompts` picker.
 *
 * Two plain queries rather than a PostgREST embedded select
 * (`design_sheets(matter_id, matters(name))`): the embedded form cannot be
 * checked column-by-column by the same safety net referenced above, and
 * `tests/query-columns.test.ts` fails outright on one rather than silently
 * skipping it — the same trade `lib/review/matterDocuments.ts` already makes.
 */
export async function loadMattersWithDesignSheets(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<MatterOption[]> {
  const sb = client

  const { data: sheets, error: sheetsError } = await sb.from('design_sheets').select('matter_id')
  if (sheetsError) throw new Error(`Could not load design sheets: ${sheetsError.message}`)
  const matterIds = [...new Set((sheets ?? []).map((sheet) => String(sheet.matter_id)))]
  if (matterIds.length === 0) return []

  const { data: matters, error: mattersError } = await sb.from('matters').select('id, name').in('id', matterIds)
  if (mattersError) throw new Error(`Could not load matters: ${mattersError.message}`)

  return (matters ?? [])
    .map((matter) => ({
      matterId: String(matter.id),
      title: (matter.name as string | null) ?? 'Untitled matter',
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}
