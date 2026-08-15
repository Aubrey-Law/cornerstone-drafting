import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compareRepresentations } from '@/lib/matterContacts/consistency'

function source(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

/**
 * Step 7a: every writer that creates a contact writes its join row itself,
 * so step 7b can drop `contacts.client_intake_id` and the trigger that reads it.
 */
const WRITERS = [
  'lib/contacts/saveHouseholdContact.ts',
  'lib/contacts/saveHouseholdChildren.ts',
  'lib/contacts/saveAdditionalContacts.ts',
  'lib/contacts/persistFiduciaryRoles.ts',
  'lib/leadFiduciaries.ts',
  'lib/lawmatics/importMatter.ts',
  'app/api/admin/leads/[id]/engagement/route.ts',
  'app/api/intake/contacts/route.ts',
  'app/api/admin/contacts/route.ts',
]

describe('every contact writer puts the person on the matter', () => {
  it.each(WRITERS)('%s calls attachContactToMatter', file => {
    // A writer that creates a contact without a join row makes that person
    // invisible: every reader has gone through the join since step 3.
    expect(source(file)).toContain('attachContactToMatter')
  })

  it('leaves the client’s own join row to matter creation', () => {
    // open_matter_for_person and sync_matter_contacts_from_matter own the self
    // row; a household writer also claiming it could contradict them.
    expect(source('lib/contacts/saveHouseholdContact.ts'))
      .toMatch(/if \(input\.relationship_type !== 'self'\)/)
  })

  it('is idempotent, so it can run alongside the trigger that still exists', () => {
    const helper = source('lib/contacts/attachContactToMatter.ts')
    expect(helper).toMatch(/onConflict: 'matter_id,contact_id'/)
  })

  it('does nothing for a person who belongs to no matter', () => {
    // A referring CPA in the directory is legitimately on none.
    expect(source('lib/contacts/attachContactToMatter.ts')).toMatch(/if \(!matterId\) return/)
  })
})

describe('detecting a writer that was missed', () => {
  const matters = [{ id: 'm1', client_intake_id: 'i1' }]
  const joinRows = [{ matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' }]

  it('reports a missed writer once, not twice', () => {
    // While client_intake_id still exists, rule 1 already names this contact as
    // missing_join_row. Reporting it again as contact_without_matter would
    // overstate the drift — the same person counted twice.
    const report = compareRepresentations({
      contacts: [
        { id: 'c-self', client_intake_id: null, relationship_type: 'self' },
        { id: 'c-orphan', client_intake_id: 'i1', relationship_type: 'child' },
      ],
      matters,
      joinRows,
      roles: [],
    })
    expect(report.countsByKind).toEqual({ missing_join_row: 1 })
  })

  it('does not flag a standalone directory contact', () => {
    const report = compareRepresentations({
      contacts: [
        { id: 'c-self', client_intake_id: null, relationship_type: 'self' },
        { id: 'c-cpa', client_intake_id: null, relationship_type: 'other', source: 'directory' },
      ],
      matters,
      joinRows,
      roles: [],
    })
    expect(report.countsByKind.contact_without_matter).toBeUndefined()
  })

  it('keys the exemption on source, not on the column 7b drops', () => {
    // The rule has to survive `contacts.client_intake_id` going away, since at
    // that point it is the only missed-writer detector left. A household person
    // on no matter is drift whether or not the legacy FK is still there.
    const report = compareRepresentations({
      contacts: [
        { id: 'c-self', client_intake_id: null, relationship_type: 'self' },
        { id: 'c-child', client_intake_id: null, relationship_type: 'child', source: 'client' },
      ],
      matters,
      joinRows,
      roles: [],
    })
    expect(report.countsByKind.contact_without_matter).toBe(1)
  })

  it('does not flag a merge tombstone', () => {
    // Step 6 detaches the loser deliberately; it is meant to be on no matter.
    const report = compareRepresentations({
      contacts: [
        { id: 'c-self', client_intake_id: null, relationship_type: 'self' },
        { id: 'c-merged', client_intake_id: 'i1', relationship_type: 'other', merged_into_id: 'c-self' },
      ],
      matters,
      joinRows,
      roles: [],
    })
    expect(report.countsByKind.contact_without_matter).toBeUndefined()
  })

  it('says so when the intake has no matter at all', () => {
    const report = compareRepresentations({
      contacts: [{ id: 'c-x', client_intake_id: 'i-none', relationship_type: 'child' }],
      matters: [],
      joinRows: [],
      roles: [],
    })
    expect(report.drift[0].detail).toMatch(/which has no matter/)
  })
})
