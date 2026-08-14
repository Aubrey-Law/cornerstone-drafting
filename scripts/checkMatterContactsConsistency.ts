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
    readAll<ContactRow>('contacts', 'id, client_intake_id, relationship_type, is_minor, child_relationship'),
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
      'Re-run with --details to list them. Do not start step 3 until this is clean.',
    )
    process.exit(1)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
