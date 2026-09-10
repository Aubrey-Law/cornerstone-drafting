import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

/**
 * Saving a design sheet without destroying somebody else's save.
 *
 * The root app's `saveLiDesignSheet` writes with no version check at all, so
 * two tabs open on one matter means the second save silently discards the
 * first — on a legal document.
 *
 * `lock_version` is the token: the caller passes the value it read, the update
 * matches on it and increments it. A save against a stale read matches no rows
 * and is reported, not swallowed.
 */

type DesignSheetsTable = WorkbenchDatabase['public']['Tables']['design_sheets']

/**
 * `lock_version` is added to `design_sheets` by the migration written in
 * Task 1 of this plan (not yet applied), so it is absent from the generated
 * types this file otherwise relies on — those are regenerated in Task 6,
 * once every migration in this phase has landed. Rather than reach for
 * `any`, the two spots that touch `lock_version` are widened by exactly
 * this one column; every other field stays checked against the real,
 * generated shape.
 */
type DesignSheetsUpdateWithLockVersion = DesignSheetsTable['Update'] & { lock_version: number }

export interface SaveDesignSheetInput {
  matterId: string
  expectedLockVersion: number
  fields: Record<string, unknown>
}

export type SaveDesignSheetResult = { ok: true } | { ok: false; reason: 'stale' }

export async function saveDesignSheet(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveDesignSheetInput,
): Promise<SaveDesignSheetResult> {
  if (Object.keys(input.fields).length === 0) {
    throw new Error('Nothing to save: an empty write would bump the lock and change no data')
  }
  if ('lock_version' in input.fields) {
    // The token is the database's to move. A caller able to set it could pass
    // whatever value it liked and defeat the check entirely.
    throw new Error('lock_version is not a field a caller may set')
  }

  const { data, error } = await client
    .from('design_sheets')
    .update({ ...input.fields, lock_version: input.expectedLockVersion + 1 } as DesignSheetsUpdateWithLockVersion)
    .eq('matter_id', input.matterId)
    // Same reason as the `Update` cast above: `lock_version` is a real column
    // the query builder's generated column-name union does not know about
    // yet.
    //
    // This cast is WIDER than it looks, and saying so is the point of this
    // comment. `.eq()` infers its value type from the column name, so
    // casting the name to `never` collapses that inference and the *value*
    // argument stops being checked too — `.eq('lock_version' as never, {})`
    // typechecks. Nothing is wrong today, because the only value passed is a
    // number. But do not copy this pattern somewhere the value is not
    // obviously correct; patch the client's Database type instead, which
    // keeps inference on both arguments.
    //
    // Both casts go away in the task that regenerates the types.
    .eq('lock_version' as never, input.expectedLockVersion)
    .select('id')

  if (error) throw new Error(`Could not save design sheet ${input.matterId}: ${error.message}`)
  // Zero rows is not an error and is emphatically not success: the sheet moved
  // under us. The caller reloads and re-applies rather than overwriting.
  return (data?.length ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'stale' }
}
