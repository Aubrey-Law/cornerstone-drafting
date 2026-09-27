import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { fullName } from '@/lib/fiduciary/repository'
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
export const DESIGN_SHEET_SELECT = 'concerns, goals_notes, drafting_notes, children, assets, specific_bequests, disinheritances, residuary_beneficiary, residual_beneficiary_individuals, residuary_distribution, spouse_citizenship, include_qdot, marital_trust_type, real_property_transfer, state, client_domicile, marital_status, trust_name, plan_type, guardian_primary, guardian_alt1, trustee_primary, trustee_alt1, executor_primary, hcp_primary, poa_primary, spouse_name, client_name, guardian_slots, temporary_guardian_slots, trustee_slots, executor_slots, hcp_slots, poa_slots, decisions'

const MATTER_SELECT = 'name'

/**
 * Same-file string literal, not built from `.filter(...)` on
 * `DESIGN_SHEET_COLUMNS` at call time — for the same reason `DESIGN_SHEET_SELECT`
 * above is a literal and not a runtime join: scripts/lib/queryReferences.mjs's
 * `stringConstants` only recognises a `const` whose initializer is itself a
 * string-literal AST node.
 */
const SLOT_COLUMNS = [
  'guardian_slots',
  'temporary_guardian_slots',
  'trustee_slots',
  'executor_slots',
  'hcp_slots',
  'poa_slots',
] as const

/**
 * The columns read to name a slot's contact. A same-file string constant so
 * tests/query-columns.test.ts and scripts/checkDbColumns.mjs can see it, same
 * as `DESIGN_SHEET_SELECT` above.
 */
const CONTACT_SELECT = 'id, first_name, middle_name, last_name'

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

/** One entry of a `*_slots` array, as it is actually stored: a foreign key. */
interface RawSlot {
  id?: unknown
  is_co?: unknown
  order?: unknown
  contact_id?: unknown
}

/**
 * A slot's `contact_id` is not always a contact.
 *
 * Two sentinels stand in for people the sheet already names itself rather than
 * through the contacts table: the client, and their spouse. They are stored in
 * the same field as a foreign key, so anything reading that field has to know
 * the difference.
 *
 * Measured 2026-09-09: 7 of 44 design sheets carry one, `__design_sheet_spouse__`
 * in 16 slots across 5 matters and `__design_sheet_client__` in 5 slots across
 * 5. Five of those matters sit at stages the audit fires on.
 */
const SENTINEL_NAME_COLUMN: Record<string, 'client_name' | 'spouse_name'> = {
  __design_sheet_client__: 'client_name',
  __design_sheet_spouse__: 'spouse_name',
}

/**
 * `contacts.id` is a uuid column, so only a uuid may be asked about.
 *
 * Until 2026-09-09 this returned every `contact_id` verbatim, sentinels
 * included, and `.in('id', ...)` handed them to Postgres — which rejects
 * `__design_sheet_client__` outright. `loadSourceRows` threw, the exception
 * left the tick through `materialiseStageTrigger`, and the stage trigger stayed
 * `claimed` with no run and no recorded error. Two matters were silently never
 * audited; five could not have been.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function slotContactIds(sheet: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  for (const column of SLOT_COLUMNS) {
    const raw = sheet[column]
    if (!Array.isArray(raw)) continue
    for (const entry of raw as RawSlot[]) {
      if (entry?.contact_id == null) continue
      const id = String(entry.contact_id)
      // A sentinel is resolved from the sheet's own columns (see
      // `resolveSlots`); anything else that is not a uuid is a reference this
      // table cannot answer, and asking would fail the whole query.
      if (UUID.test(id)) ids.add(id)
    }
  }
  return [...ids]
}

/** A sheet column holding a person's name, when it holds one. */
function sheetName(sheet: Record<string, unknown>, column: 'client_name' | 'spouse_name'): string | null {
  const value = sheet[column]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Replaces every `*_slots` array's entries with `{ order, is_co, name }`,
 * dropping `contact_id` — a foreign key a model cannot answer "is Thomas
 * Parker in this plan?" from. A slot whose contact is missing from
 * `contactNameById` becomes `name: null` rather than being dropped: an
 * unresolvable reference is a fact about the matter (a contact record that
 * was deleted or never linked correctly), not something to hide from the
 * check that would otherwise report it absent.
 *
 * A column that is not an array (`null`, or simply not selected) is left
 * exactly as it was — there is nothing to resolve.
 */
function resolveSlots(
  sheet: Record<string, unknown>,
  contactNameById: Map<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...sheet }
  for (const column of SLOT_COLUMNS) {
    const raw = sheet[column]
    if (!Array.isArray(raw)) continue
    resolved[column] = (raw as RawSlot[]).map((entry) => {
      const contactId = entry?.contact_id != null ? String(entry.contact_id) : null
      const sentinel = contactId ? SENTINEL_NAME_COLUMN[contactId] : undefined
      return {
        order: entry?.order ?? null,
        is_co: entry?.is_co ?? null,
        // A sentinel names the client or the spouse, and the sheet holds both
        // already. Leaving it `null` instead would be worse than the crash it
        // replaced: check 2 asks whether a person named in the free text
        // appears in the structured decisions, so a spouse serving as trustee
        // would read as an unnamed slot and be reported missing from the plan.
        name: sentinel
          ? sheetName(sheet, sentinel)
          : contactId
            ? (contactNameById.get(contactId) ?? null)
            : null,
      }
    })
  }
  return resolved
}

/**
 * The matter and its latest design sheet, read as exactly the columns a
 * field-audit prompt is ever allowed to reference — with every `*_slots`
 * column's contact references resolved to names (see `resolveSlots`).
 *
 * The resolution happens here, in the app, not in packages/citations: that
 * package knows nothing about a database, and reaching into `contacts` from
 * inside it would be the first crack in a boundary this branch has otherwise
 * held throughout.
 *
 * Null when the matter does not exist, or exists but has no design sheet yet
 * — an audit has nothing to run against either way, and the caller is better
 * placed than this function to decide what to say about that.
 */
export async function loadSourceRows(
  client: SupabaseClient<GeneratedDatabase>,
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

  const sheet = sheetRow as Record<string, unknown>
  const contactIds = slotContactIds(sheet)
  let contactNameById = new Map<string, string>()
  if (contactIds.length > 0) {
    const { data: contacts, error: contactError } = await sb
      .from('contacts')
      .select(CONTACT_SELECT)
      .in('id', contactIds)
    if (contactError) throw new Error(`Could not load contacts: ${contactError.message}`)
    contactNameById = new Map((contacts ?? []).map((c) => [String(c.id), fullName(c as Record<string, unknown>)]))
  }

  return {
    design_sheet: resolveSlots(sheet, contactNameById),
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
  client: SupabaseClient<GeneratedDatabase>,
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
