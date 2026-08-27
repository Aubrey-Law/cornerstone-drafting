import { getAdminClient } from '@/lib/supabaseAdmin'
import { DEFAULT_STYLE_SET } from '@/lib/styleSets/defaults'
import { parseStyleSetSettings, type StyleSetSettings } from '@/lib/styleSets/schema'

/**
 * Reading and writing stored style sets.
 *
 * The generator must never fail to produce a document because formatting
 * configuration could not be read. Every resolver here therefore degrades to
 * `DEFAULT_STYLE_SET` — the pre-style-set Garamond sweep — rather than
 * throwing. A draft in last month's formatting is a nuisance; a draft that does
 * not exist because a settings row was malformed is an outage.
 */

export interface StyleSetRow {
  id: string
  name: string
  description: string | null
  settings: unknown
  is_default: boolean
  source_file_name: string | null
  source_r2_key: string | null
  source_size_bytes: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** A row with its settings already validated. */
export interface StyleSet extends Omit<StyleSetRow, 'settings'> {
  settings: StyleSetSettings
}

function styleSetsDb() {
  // The generated Database type is regenerated separately from the migration
  // that adds this table, following the boundary established in
  // lib/works/data.ts. Narrow it back to StyleSetRow at every call site below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAdminClient() as any
}

const LIVE_COLUMNS =
  'id, name, description, settings, is_default, source_file_name, source_r2_key, source_size_bytes, created_by, created_at, updated_at, deleted_at'

/**
 * Validate a stored row, or drop it.
 *
 * A row whose settings do not parse is reported and skipped rather than
 * substituted with defaults, because a style set silently rendering as
 * something other than what its editor shows is the one failure mode that
 * would go unnoticed the longest.
 */
function toStyleSet(row: StyleSetRow): StyleSet | null {
  try {
    return { ...row, settings: parseStyleSetSettings(row.settings) }
  } catch (error) {
    console.error(`style_sets: row ${row.id} has unusable settings`, error)
    return null
  }
}

export async function listStyleSets(): Promise<StyleSet[]> {
  const { data, error } = await styleSetsDb()
    .from('style_sets')
    .select(LIVE_COLUMNS)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return ((data ?? []) as StyleSetRow[]).flatMap(row => {
    const parsed = toStyleSet(row)
    return parsed ? [parsed] : []
  })
}

export async function getStyleSet(id: string): Promise<StyleSet | null> {
  const { data, error } = await styleSetsDb()
    .from('style_sets')
    .select(LIVE_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? toStyleSet(data as StyleSetRow) : null
}

/**
 * The settings to render with, given an optional explicit choice.
 *
 * Precedence: the named style set, then whichever row is marked default, then
 * the built-in legacy sweep. Each step falls through on absence *or* failure,
 * so a deleted style set on an old matter renders in the firm default rather
 * than erroring.
 */
export async function resolveStyleSet(id?: string | null): Promise<StyleSetSettings> {
  try {
    if (id) {
      const chosen = await getStyleSet(id)
      if (chosen) return chosen.settings
    }

    const { data, error } = await styleSetsDb()
      .from('style_sets')
      .select(LIVE_COLUMNS)
      .eq('is_default', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const parsed = data ? toStyleSet(data as StyleSetRow) : null
    return parsed?.settings ?? DEFAULT_STYLE_SET
  } catch (error) {
    // Formatting configuration is never worth failing a generation over.
    console.error('style_sets: falling back to the built-in default', error)
    return DEFAULT_STYLE_SET
  }
}

export interface SaveStyleSetInput {
  name: string
  description?: string | null
  settings: unknown
  isDefault?: boolean
  sourceFileName?: string | null
  sourceR2Key?: string | null
  sourceSizeBytes?: number | null
  createdBy?: string | null
}

/**
 * Create a style set, validating its settings before they reach the database.
 *
 * Parsing here rather than trusting the caller means a malformed blob is
 * rejected at the point somebody can still fix it, instead of being discovered
 * by `toStyleSet` months later when a document renders wrong.
 */
export async function createStyleSet(input: SaveStyleSetInput): Promise<StyleSet> {
  const settings = parseStyleSetSettings(input.settings)
  if (input.isDefault) await clearDefault()

  const { data, error } = await styleSetsDb()
    .from('style_sets')
    .insert({
      name: input.name,
      description: input.description ?? null,
      settings,
      is_default: input.isDefault ?? false,
      source_file_name: input.sourceFileName ?? null,
      source_r2_key: input.sourceR2Key ?? null,
      source_size_bytes: input.sourceSizeBytes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select(LIVE_COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  return { ...(data as StyleSetRow), settings }
}

export async function updateStyleSet(
  id: string,
  patch: Partial<SaveStyleSetInput>,
): Promise<StyleSet> {
  const settings = patch.settings === undefined ? undefined : parseStyleSetSettings(patch.settings)
  if (patch.isDefault) await clearDefault(id)

  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description
  if (settings !== undefined) update.settings = settings
  if (patch.isDefault !== undefined) update.is_default = patch.isDefault
  if (patch.sourceFileName !== undefined) update.source_file_name = patch.sourceFileName
  if (patch.sourceR2Key !== undefined) update.source_r2_key = patch.sourceR2Key
  if (patch.sourceSizeBytes !== undefined) update.source_size_bytes = patch.sourceSizeBytes

  const { data, error } = await styleSetsDb()
    .from('style_sets')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select(LIVE_COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  const parsed = toStyleSet(data as StyleSetRow)
  if (!parsed) throw new Error('Saved style set could not be read back')
  return parsed
}

/**
 * Soft delete.
 *
 * A generated document records the style set that produced it, so removing the
 * row outright would strip the provenance from work already delivered to a
 * client.
 */
export async function deleteStyleSet(id: string): Promise<void> {
  const { error } = await styleSetsDb()
    .from('style_sets')
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq('id', id)
    .is('deleted_at', null)

  if (error) throw new Error(error.message)
}

/**
 * Stand down the current default before another row claims it.
 *
 * The partial unique index enforces at most one default, so without this an
 * attempt to promote a second style set fails on a constraint rather than
 * moving the flag.
 */
async function clearDefault(exceptId?: string): Promise<void> {
  let query = styleSetsDb().from('style_sets').update({ is_default: false }).eq('is_default', true)
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) throw new Error(error.message)
}
