import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildFirmPeople } from '@/lib/queries/firmDirectory'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260925000000_matter_contacts_join.sql'

describe('matter_contacts join table', () => {
  const migration = source(MIGRATION)

  it('joins a person to a matter, not to a household', () => {
    expect(migration).toMatch(/create table if not exists public\.matter_contacts/i)
    expect(migration).toMatch(/matter_id\s+uuid not null references public\.matters\(id\) on delete cascade/i)
    expect(migration).toMatch(/contact_id\s+uuid not null references public\.contacts\(id\) on delete cascade/i)
  })

  it('caps a matter at one primary client and one spouse', () => {
    // Replaces uq_contacts_one_spouse, which is keyed on the intake and cannot
    // survive a client with two matters.
    expect(migration).toMatch(/matter_contacts_one_self[\s\S]{0,120}where relationship_type = 'self'/i)
    expect(migration).toMatch(/matter_contacts_one_spouse[\s\S]{0,120}where relationship_type = 'spouse'/i)
    expect(migration).toMatch(/unique \(matter_id, contact_id\)/i)
  })

  it('carries the matter-relative facts, so the same person can differ per matter', () => {
    // The College Prep case: one human, 'child' on the parents' matter and
    // 'self' on their own. These cannot live on `contacts` any more.
    for (const column of ['relationship_type', 'child_relationship', 'parentage', 'is_minor', 'for_party']) {
      expect(migration).toMatch(new RegExp(`\\s${column}\\s`, 'i'))
    }
  })

  it('indexes the every-matter-for-this-person lookup the feature exists for', () => {
    expect(migration).toMatch(/matter_contacts_contact_idx[\s\S]{0,80}\(contact_id\)/i)
  })

  it('gives fiduciary appointments a matter of their own', () => {
    // A trustee named in a 2024 trust is not the trustee of a 2026 engagement.
    expect(migration).toMatch(/alter table public\.contact_roles[\s\S]{0,120}add column if not exists matter_id uuid references public\.matters\(id\)/i)
  })

  it('leaves the legacy household FK in place — step 1 changes no reader', () => {
    expect(migration).not.toMatch(/drop column[\s\S]{0,40}client_intake_id/i)
    expect(migration).not.toMatch(/alter table public\.contacts[\s\S]{0,80}drop/i)
  })
})

describe('matter_contacts backfill', () => {
  const migration = source(MIGRATION)

  it('creates one self contact per intake, not per matter', () => {
    // Keyed per intake so a client who already has two matters ends up as one
    // person on both, rather than two people.
    expect(migration).toMatch(/'backfill_self:' \|\| ci\.id::text/)
    expect(migration).toMatch(/where exists \(select 1 from public\.matters m where m\.client_intake_id = ci\.id\)/i)
  })

  it('keeps the self rows out of every intake-scoped reader', () => {
    // client_intake_id NULL is what makes getHousehold, persistFiduciaryRoles'
    // name matching, and buildDraftPayload unable to see them.
    expect(migration).toMatch(/insert into public\.contacts \([\s\S]{0,400}\)\s*select\s*\n\s*null, 'self'/i)
  })

  it('guards the partial unique indexes that ON CONFLICT cannot reach', () => {
    // `on conflict (matter_id, contact_id)` does not cover
    // matter_contacts_one_self, so a matter that already names a different
    // person as its client raised instead of skipping.
    expect(migration).toMatch(/where not exists \(\s*select 1 from public\.matter_contacts existing\s*where existing\.matter_id = m\.id and existing\.relationship_type = 'self'/i)
  })

  it('refuses to guess when an intake carries more than one matter', () => {
    expect(migration).toMatch(/Cannot backfill contact_roles\.matter_id/i)
    // Only work that remains — a role backfilled on an earlier run is settled
    // history, not an ambiguity to re-raise on every re-run.
    expect(migration).toMatch(/and cr\.matter_id is null/i)
  })

  it('does not deduplicate people', () => {
    // Merging is destructive and attorney-reviewed (step 6). A migration that
    // merged on matching email would merge a couple who share an inbox.
    expect(migration).not.toMatch(/merged_into/i)
    expect(migration).not.toMatch(/delete from public\.contacts/i)
  })
})

describe('self contacts stay invisible until the readers flip', () => {
  it('does not mirror a self contact into the CRM hub', () => {
    // sync_crm_person_from_intake already maintains a CRM person for the same
    // human; mirroring the contact too would show them twice.
    const migration = source(MIGRATION)
    expect(migration).toMatch(/create or replace function public\.sync_crm_person_from_contact/i)
    expect(migration).toMatch(/if new\.relationship_type = 'self' then\s*return new;/i)
  })

  it('excludes them from the contacts directory query', () => {
    expect(source('lib/queries/contactsDirectory.ts')).toMatch(
      /\.not\('relationship_type', 'in', '\("client","self"\)'\)/,
    )
  })

  it('excludes them from the firm directory', () => {
    const people = buildFirmPeople(
      [{
        id: 'intake-1', full_name: 'Ada Byron', first_name: 'Ada', last_name: 'Byron',
        preferred_name: null, email: 'ada@example.com', phone: null,
        practice_area: 'EP', lead_status: 'hired', matter_id: 'matter-1',
      }] as never,
      [
        {
          id: 'contact-self', client_intake_id: null, first_name: 'Ada', last_name: 'Byron',
          preferred_name: null, email: null, phone: null,
          relationship_type: 'self', relationship_label: null, deceased: null,
        },
        {
          id: 'contact-child', client_intake_id: 'intake-1', first_name: 'Lovelace',
          last_name: 'Byron', preferred_name: null, email: null, phone: null,
          relationship_type: 'child', relationship_label: null, deceased: null,
        },
      ] as never,
      [{ id: 'matter-1', matter_number: '2026-EP-001', relationship_status: 'hired', status: 'active', stage: 'drafting' }] as never,
    )

    // Ada appears once — from her intake, not a second time as a self contact.
    expect(people.filter(p => p.name === 'Ada Byron')).toHaveLength(1)
    expect(people.some(p => p.contactId === 'contact-self')).toBe(false)
    // Household contacts are untouched.
    expect(people.some(p => p.contactId === 'contact-child')).toBe(true)
  })
})

describe('write-through to client_intake', () => {
  const migration = source(MIGRATION)

  it('keeps client_intake person columns as a projection of the self contact', () => {
    // Rather than repoint the leads UI, engagement rendering and email
    // templates now, mirror the same pattern the CRM sync already uses.
    expect(migration).toMatch(/create or replace function public\.sync_intake_from_self_contact/i)
    expect(migration).toMatch(/update public\.client_intake ci/i)
  })

  it('fires on update only, so the backfill cannot churn lead aging', () => {
    // The backfill copies FROM client_intake; firing on insert would write the
    // same values back and bump updated_at on every row, which lead aging and
    // list ordering read.
    expect(migration).toMatch(/create trigger sync_intake_from_self_contact\s*\n\s*after update of/i)
    expect(migration).not.toMatch(/create trigger sync_intake_from_self_contact\s*\n\s*after insert/i)
  })

  it('resolves the intake through the join, not a single FK', () => {
    // A self contact reaches more than one intake once a client has two matters.
    expect(migration).toMatch(/from public\.matter_contacts mc\s*join public\.matters m on m\.id = mc\.matter_id/i)
  })
})

describe('matter_contacts RLS', () => {
  const migration = source(MIGRATION)

  it('is enabled, and not readable by anonymous callers', () => {
    expect(migration).toMatch(/alter table public\.matter_contacts enable row level security/i)
    expect(migration).not.toMatch(/to anon/i)
  })

  it('lets a portal client see only their own matters', () => {
    expect(migration).toMatch(/clients_read_own_matter_contacts[\s\S]{0,400}ci\.user_id = auth\.uid\(\) or ci\.client_user_id = auth\.uid\(\)/i)
  })

  it('gives staff full access', () => {
    expect(migration).toMatch(/attorneys_all_matter_contacts[\s\S]{0,300}u\.role in \('attorney', 'admin'\)/i)
  })
})
