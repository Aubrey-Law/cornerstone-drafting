/**
 * Reports any gap between `contacts.client_intake_id` and `matter_contacts`
 * while step 2 of docs/matter-contacts-migration.md dual-writes both.
 *
 * Run: npm run check:matter-contacts [-- --details]
 *
 * Exits 1 when the two representations disagree, so it can run on a schedule
 * for the few days before step 3 flips the readers. A gap found now is cheap;
 * the same gap found after the readers move is a wrong draft.
 */
import { config } from 'dotenv'

// The script is run from a shell, not from Next, so nothing has loaded the
// environment yet — without this it dies on "supabaseUrl is required". Same
// order and flags seedBrowserFixture uses: `override: false` means an
// already-exported variable still wins, so callers can point it at a different
// database without editing a file.
config({ path: '.env.test', override: false })
config({ path: '.env.local', override: false })

// Static import is safe: getAdminClient reads the environment when it is first
// called, inside main(), not when this module is evaluated.
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  compareRepresentations,
  type ContactRow,
  type JoinRow,
  type MatterRow,
  type RoleRow,
} from '@/lib/matterContacts/consistency'

const PAGE = 1000

/** Supabase caps a select at 1000 rows; these tables are already larger. */
async function readAll<T>(table: string, columns: string): Promise<T[]> {
  const admin = getAdminClient()
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

async function main() {
  const showDetails = process.argv.includes('--details')

  const [contacts, matters, joinRows, roles] = await Promise.all([
    readAll<ContactRow>('contacts', 'id, client_intake_id, relationship_type, is_minor, child_relationship, merged_into_id, source'),
    readAll<MatterRow>('matters', 'id, client_intake_id'),
    readAll<JoinRow>('matter_contacts', 'matter_id, contact_id, relationship_type, is_minor, child_relationship'),
    readAll<RoleRow>('contact_roles', 'id, client_intake_id, matter_id'),
  ])

  const report = compareRepresentations({ contacts, matters, joinRows, roles })

  console.log(JSON.stringify({
    mattersReviewed: report.mattersReviewed,
    contactsReviewed: report.contactsReviewed,
    joinRowsReviewed: report.joinRowsReviewed,
    multiMatterIntakes: report.multiMatterIntakes,
    drift: report.drift.length,
    countsByKind: report.countsByKind,
  }, null, 2))

  if (showDetails && report.drift.length) {
    console.log(JSON.stringify(report.drift, null, 2))
  }

  if (report.drift.length) {
    console.error(
      `\n${report.drift.length} disagreement(s) between contacts.client_intake_id and matter_contacts. ` +
      'Re-run with --details to list them.\n' +
      'contact_without_matter is a person no reader can see — usually an intake that ' +
      'never became a matter, not a writer bug. The rest mean the two representations ' +
      'disagree, and step 7b should not drop the legacy column until they are clear.',
    )
    process.exit(1)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
