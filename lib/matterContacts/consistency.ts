/**
 * Compares the two representations of "who is on this matter" while step 2 of
 * docs/matter-contacts-migration.md dual-writes both.
 *
 * The legacy representation is `contacts.client_intake_id` walked through to
 * the intake's matters. The new one is `matter_contacts`. Until step 3 flips
 * the readers, any gap between them is a dual-write bug — and the point of
 * running this for a few days before flipping is that a gap found now is
 * cheap, while one found after the readers move is a wrong draft.
 *
 * Split from the script so it can be tested without a database.
 */

export interface ContactRow {
  id: string
  client_intake_id: string | null
  relationship_type: string | null
  /** Set once merged away (step 6); such a row is meant to be on no matter. */
  merged_into_id?: string | null
  is_minor?: boolean | null
  child_relationship?: string | null
}

export interface MatterRow {
  id: string
  client_intake_id: string | null
}

export interface JoinRow {
  matter_id: string
  contact_id: string
  relationship_type: string | null
  is_minor?: boolean | null
  child_relationship?: string | null
}

export interface RoleRow {
  id: string
  client_intake_id: string | null
  matter_id: string | null
}

export type DriftKind =
  | 'missing_join_row'
  | 'orphan_join_row'
  | 'matter_without_self'
  | 'relationship_mismatch'
  | 'role_without_matter'
  | 'contact_without_matter'

export interface Drift {
  kind: DriftKind
  matterId: string | null
  contactId: string | null
  detail: string
}

export interface ConsistencyReport {
  mattersReviewed: number
  contactsReviewed: number
  joinRowsReviewed: number
  /** Intakes carrying more than one matter — the population step 5 creates. */
  multiMatterIntakes: number
  drift: Drift[]
  countsByKind: Record<string, number>
}

function key(matterId: string, contactId: string): string {
  return `${matterId}:${contactId}`
}

export function compareRepresentations(input: {
  contacts: ContactRow[]
  matters: MatterRow[]
  joinRows: JoinRow[]
  roles: RoleRow[]
}): ConsistencyReport {
  const { contacts, matters, joinRows, roles } = input
  const drift: Drift[] = []

  const mattersByIntake = new Map<string, MatterRow[]>()
  for (const matter of matters) {
    if (!matter.client_intake_id) continue
    const list = mattersByIntake.get(matter.client_intake_id) ?? []
    list.push(matter)
    mattersByIntake.set(matter.client_intake_id, list)
  }

  const joinByKey = new Map<string, JoinRow>()
  for (const row of joinRows) joinByKey.set(key(row.matter_id, row.contact_id), row)

  const contactById = new Map(contacts.map(c => [c.id, c]))

  // 1. Every legacy edge should have a join row, with the same facts on it.
  for (const contact of contacts) {
    if (!contact.client_intake_id) continue
    for (const matter of mattersByIntake.get(contact.client_intake_id) ?? []) {
      const joinRow = joinByKey.get(key(matter.id, contact.id))
      if (!joinRow) {
        drift.push({
          kind: 'missing_join_row',
          matterId: matter.id,
          contactId: contact.id,
          detail: `contact is on intake ${contact.client_intake_id} but absent from matter_contacts`,
        })
        continue
      }
      if (joinRow.relationship_type !== contact.relationship_type) {
        drift.push({
          kind: 'relationship_mismatch',
          matterId: matter.id,
          contactId: contact.id,
          detail: `contacts says '${contact.relationship_type}', matter_contacts says '${joinRow.relationship_type}'`,
        })
      }
    }
  }

  // 2. Every join row should trace back to a legacy edge. Self rows are the
  //    deliberate exception — they carry no intake FK by design, which is what
  //    keeps them invisible to the readers that have not flipped yet.
  for (const row of joinRows) {
    if (row.relationship_type === 'self') continue
    const contact = contactById.get(row.contact_id)
    if (!contact) {
      drift.push({
        kind: 'orphan_join_row',
        matterId: row.matter_id,
        contactId: row.contact_id,
        detail: 'join row references a contact that no longer exists',
      })
      continue
    }
    const matterIds = new Set((mattersByIntake.get(contact.client_intake_id ?? '') ?? []).map(m => m.id))
    if (!matterIds.has(row.matter_id)) {
      drift.push({
        kind: 'orphan_join_row',
        matterId: row.matter_id,
        contactId: row.contact_id,
        detail: `join row has no legacy edge (contact intake ${contact.client_intake_id ?? 'null'})`,
      })
    }
  }

  // 3. Every matter should name exactly one primary client. More than one is
  //    impossible (matter_contacts_one_self); none means the self promotion
  //    missed it.
  const selfByMatter = new Set(joinRows.filter(r => r.relationship_type === 'self').map(r => r.matter_id))
  for (const matter of matters) {
    if (!matter.client_intake_id) continue
    if (!selfByMatter.has(matter.id)) {
      drift.push({
        kind: 'matter_without_self',
        matterId: matter.id,
        contactId: null,
        detail: 'no self contact — the matter has no primary client in the join',
      })
    }
  }

  // 4. Roles should carry a matter. The trigger leaves it unset when the
  //    intake has two matters, which is correct but has to be resolved by hand
  //    before step 3 re-keys them.
  for (const role of roles) {
    if (role.matter_id || !role.client_intake_id) continue
    const count = (mattersByIntake.get(role.client_intake_id) ?? []).length
    drift.push({
      kind: 'role_without_matter',
      matterId: null,
      contactId: null,
      detail: count > 1
        ? `role ${role.id}: intake ${role.client_intake_id} has ${count} matters, target is ambiguous`
        : `role ${role.id}: intake ${role.client_intake_id} has no matter to attach to`,
    })
  }

  // 5. A household contact on no matter at all — invisible to every reader,
  //    since step 3. Standalone directory contacts (a referring CPA) and merge
  //    tombstones are legitimately like this and are skipped.
  //
  //    Scoped to intakes that have no matter, because where the intake *does*
  //    have one, rule 1 already reports the same contact as `missing_join_row`
  //    and naming it twice would overstate the drift.
  //
  //    This becomes the primary missed-writer detector in step 7b: once
  //    `contacts.client_intake_id` is dropped there is no legacy edge left to
  //    compare, so rule 1 can no longer be computed and this is what remains.
  const contactsOnMatters = new Set(joinRows.map(r => r.contact_id))
  for (const contact of contacts) {
    if (!contact.client_intake_id) continue      // standalone directory entry
    if (contact.merged_into_id) continue          // merged away, kept as a tombstone
    if (contactsOnMatters.has(contact.id)) continue
    if ((mattersByIntake.get(contact.client_intake_id) ?? []).length > 0) continue
    drift.push({
      kind: 'contact_without_matter',
      matterId: null,
      contactId: contact.id,
      detail: `contact is on intake ${contact.client_intake_id}, which has no matter — invisible to every reader`,
    })
  }

  const countsByKind = drift.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1
    return acc
  }, {})

  let multiMatterIntakes = 0
  for (const list of mattersByIntake.values()) if (list.length > 1) multiMatterIntakes += 1

  return {
    mattersReviewed: matters.length,
    contactsReviewed: contacts.length,
    joinRowsReviewed: joinRows.length,
    multiMatterIntakes,
    drift,
    countsByKind,
  }
}
