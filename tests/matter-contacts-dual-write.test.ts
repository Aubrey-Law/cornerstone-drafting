import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compareRepresentations } from '@/lib/matterContacts/consistency'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260926000000_matter_contacts_dual_write.sql'

describe('dual-write lives in the database', () => {
  const migration = source(MIGRATION)

  it('triggers on both sides, so no writer can bypass it', () => {
    // 24 contact writes across 13 TypeScript files, plus SECURITY DEFINER
    // functions that never go through the app. Patching each one diverges
    // silently the first time one is missed.
    expect(migration).toMatch(/create trigger sync_matter_contacts_from_matter\s*\n\s*after insert on public\.matters/i)
    expect(migration).toMatch(/create trigger sync_matter_contacts_from_contact\s*\n\s*after insert or update of/i)
  })

  it('needs no delete trigger, because both foreign keys cascade', () => {
    expect(migration).toMatch(/cascades on both foreign keys/i)
    expect(migration).not.toMatch(/after delete on public\.contacts/i)
  })

  it('gives a new matter its primary client and the whole household', () => {
    // A matter opened for an existing client inherits their spouse, children
    // and fiduciaries rather than re-collecting them.
    expect(migration).toMatch(/insert into public\.matter_contacts \(matter_id, contact_id, relationship_type\)\s*values \(new\.id, v_self_id, 'self'\)/i)
    expect(migration).toMatch(/where c\.client_intake_id = new\.client_intake_id/i)
  })

  it('resolves the primary client through the join, not the backfill source string', () => {
    expect(migration).toMatch(/create or replace function public\.self_contact_for_intake/i)
    expect(migration).toMatch(/where m\.client_intake_id = p_intake_id\s*and mc\.relationship_type = 'self'/i)
  })

  it('moves join rows when a contact changes household', () => {
    expect(migration).toMatch(/if tg_op = 'UPDATE' and old\.client_intake_id is distinct from new\.client_intake_id then/i)
    expect(migration).toMatch(/delete from public\.matter_contacts mc/i)
  })

  it('keeps the partial-index guard the step 1 backfill needed', () => {
    expect(migration).toMatch(/and c\.relationship_type in \('self', 'spouse'\)/i)
  })
})

describe('the two self-sync triggers cannot recurse', () => {
  const migration = source(MIGRATION)

  it('syncs the self contact from the intake while the app still writes there', () => {
    expect(migration).toMatch(/create trigger sync_self_contact_from_intake\s*\n\s*after update of/i)
  })

  it('guards both directions on a real value change', () => {
    // Postgres fires an UPDATE trigger even when the values are unchanged, so
    // without this the two triggers write to each other until the stack blows.
    const forward = migration.slice(migration.indexOf('sync_self_contact_from_intake'))
    expect(forward).toMatch(/c\.first_name\s+is distinct from new\.first_name/i)
    const back = migration.slice(migration.indexOf('function public.sync_intake_from_self_contact'))
    expect(back).toMatch(/ci\.first_name\s+is distinct from new\.first_name/i)
  })

  it('fills a role matter only when the answer is unambiguous', () => {
    // Guessing would silently attach an appointment to the wrong engagement.
    expect(migration).toMatch(/new\.matter_id := null/i)
    expect(migration).toMatch(/create trigger sync_contact_role_matter\s*\n\s*before insert on public\.contact_roles/i)
  })
})

describe('consistency check', () => {
  const matters = [{ id: 'm1', client_intake_id: 'i1' }]
  const contacts = [
    { id: 'c-self', client_intake_id: null, relationship_type: 'self' },
    { id: 'c-spouse', client_intake_id: 'i1', relationship_type: 'spouse' },
  ]

  it('is quiet when both representations agree', () => {
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' },
      ],
      roles: [],
    })
    expect(report.drift).toEqual([])
  })

  it('catches a legacy edge that never reached the join', () => {
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [{ matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' }],
      roles: [],
    })
    expect(report.countsByKind).toEqual({ missing_join_row: 1 })
  })

  it('catches a matter with no primary client', () => {
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [{ matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' }],
      roles: [],
    })
    expect(report.countsByKind).toEqual({ matter_without_self: 1 })
  })

  it('catches a join row with nothing behind it', () => {
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' },
        { matter_id: 'm1', contact_id: 'c-ghost', relationship_type: 'other' },
      ],
      roles: [],
    })
    expect(report.countsByKind).toEqual({ orphan_join_row: 1 })
  })

  it('catches the two representations disagreeing about a relationship', () => {
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'child' },
      ],
      roles: [],
    })
    expect(report.countsByKind).toEqual({ relationship_mismatch: 1 })
  })

  it('does not treat a self row as an orphan', () => {
    // Self contacts carry no intake FK by design — that is what keeps them
    // invisible to the readers that have not flipped yet.
    const report = compareRepresentations({
      contacts,
      matters,
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' },
      ],
      roles: [],
    })
    expect(report.drift.filter(d => d.kind === 'orphan_join_row')).toEqual([])
  })

  it('reports an ambiguous role and counts the intake that caused it', () => {
    const report = compareRepresentations({
      contacts,
      matters: [
        { id: 'm1', client_intake_id: 'i1' },
        { id: 'm2', client_intake_id: 'i1' },
      ],
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm2', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' },
        { matter_id: 'm2', contact_id: 'c-spouse', relationship_type: 'spouse' },
      ],
      roles: [{ id: 'r1', client_intake_id: 'i1', matter_id: null }],
    })
    expect(report.multiMatterIntakes).toBe(1)
    expect(report.countsByKind).toEqual({ role_without_matter: 1 })
    expect(report.drift[0].detail).toMatch(/has 2 matters, target is ambiguous/)
  })

  it('ignores standalone directory contacts, which belong to no matter', () => {
    const report = compareRepresentations({
      contacts: [...contacts, { id: 'c-cpa', client_intake_id: null, relationship_type: 'other' }],
      matters,
      joinRows: [
        { matter_id: 'm1', contact_id: 'c-self', relationship_type: 'self' },
        { matter_id: 'm1', contact_id: 'c-spouse', relationship_type: 'spouse' },
      ],
      roles: [],
    })
    expect(report.drift).toEqual([])
  })
})
