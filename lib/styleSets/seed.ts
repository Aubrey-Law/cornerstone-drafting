import { getAdminClient } from '@/lib/supabaseAdmin'
import { BUILT_IN_STYLE_SETS, type BuiltInStyleSetId } from '@/lib/styleSets/defaults'
import { parseStyleSetSettings, type StyleSetSettings } from '@/lib/styleSets/schema'

/**
 * Put the built-in style sets into the table so the editor opens with something
 * in it.
 *
 * Without this the feature is complete and invisible: the engine ships two
 * style sets as constants, the editor lists rows, and nothing connects them —
 * so a firm's first sight of style sets is an empty page, and the house style
 * they already wrote down by hand has to be typed in again.
 *
 * **Nothing here publishes anything.** Seeding creates rows to look at; it does
 * not mark a default, so generated documents keep rendering exactly as they do
 * now until somebody chooses otherwise in the UI. Adopting a style set changes
 * every document the firm produces, and that belongs to a person looking at the
 * preview, not to a script.
 */

export interface SeedStyleSetsResult {
  created: string[]
  /** Present already and left exactly as they are. */
  unchanged: string[]
  /** Present and edited since seeding, so deliberately not overwritten. */
  preserved: string[]
}

/** Name and description for each built-in, so the list reads as prose. */
const SEED_METADATA: Record<BuiltInStyleSetId, { name: string; description: string }> = {
  legacyGaramond: {
    name: 'Garamond only',
    description:
      'What the generator did before style sets existed: every font set to Garamond, everything else left as the template has it.',
  },
  aubreyHouse: {
    name: 'Aubrey Law house style',
    description:
      'Garamond throughout, document titles capped at 14pt, and the lettered (a) level at a quarter inch with no hanging indent. Notary blocks, article line breaks and run-in sections are still a manual pass.',
  },
}

/**
 * Insert any built-in style set the table does not already have.
 *
 * Matching is by name, and an existing row is never rewritten. Somebody who
 * adjusted the house style and then re-ran the seed should find their edits
 * intact — a seed that clobbered them would be worse than one that never ran.
 */
export async function seedStyleSets(): Promise<SeedStyleSetsResult> {
  // The generated Database type is regenerated separately from the migration
  // that adds this table, following the boundary in lib/works/data.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any

  const { data, error } = await db
    .from('style_sets')
    .select('id, name, settings')
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  const existing = new Map<string, { id: string; settings: unknown }>(
    ((data ?? []) as Array<{ id: string; name: string; settings: unknown }>).map(row => [
      row.name.toLowerCase(),
      { id: row.id, settings: row.settings },
    ]),
  )

  const result: SeedStyleSetsResult = { created: [], unchanged: [], preserved: [] }

  for (const [id, settings] of Object.entries(BUILT_IN_STYLE_SETS)) {
    const meta = SEED_METADATA[id as BuiltInStyleSetId]
    const found = existing.get(meta.name.toLowerCase())

    if (found) {
      // Tell "untouched" apart from "edited" so the report says which, rather
      // than reporting every existing row as an anonymous skip.
      ;(matchesSeed(found.settings, settings) ? result.unchanged : result.preserved).push(meta.name)
      continue
    }

    const { error: insertError } = await db.from('style_sets').insert({
      name: meta.name,
      description: meta.description,
      settings,
      is_default: false,
    })
    if (insertError) throw new Error(`${meta.name}: ${insertError.message}`)
    result.created.push(meta.name)
  }

  return result
}

/** True when a stored row still holds exactly what the seed would write. */
function matchesSeed(stored: unknown, seeded: StyleSetSettings): boolean {
  try {
    return JSON.stringify(parseStyleSetSettings(stored)) === JSON.stringify(seeded)
  } catch {
    // Unparseable settings are certainly not the seed's, and are somebody's to
    // look at rather than the seed's to silently replace.
    return false
  }
}
