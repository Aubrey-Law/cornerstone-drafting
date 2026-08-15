import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260927000000_matter_contacts_rls.sql'

describe('contact RLS moves onto the join', () => {
  const migration = source(MIGRATION)

  it('scopes a portal client to the people on their matters', () => {
    expect(migration).toMatch(/create policy "clients_read_own_contacts"[\s\S]{0,600}from public\.matter_contacts mc/i)
    expect(migration).toMatch(/ci\.user_id = auth\.uid\(\) or ci\.client_user_id = auth\.uid\(\)/i)
  })

  it('replaces the household-keyed policies rather than leaving both', () => {
    // Left in place, the old policy would be a second permissive rule — RLS
    // ORs them, so the narrower new one would grant nothing extra but the old
    // one would keep granting on a column that is write-only.
    expect(migration).toMatch(/drop policy if exists "clients_manage_own_contacts" on public\.contacts/i)
    expect(migration).toMatch(/drop policy if exists "clients_manage_own_contact_roles" on public\.contact_roles/i)
  })

  it('narrows the portal from FOR ALL to SELECT', () => {
    // The portal has one client-side reader and no client-side writer; every
    // write goes through a service-role route, which bypasses RLS anyway.
    expect(migration).toMatch(/create policy "clients_read_own_contacts"\s*\n\s*on public\.contacts for select to authenticated/i)
    expect(migration).toMatch(/create policy "clients_read_own_contact_roles"\s*\n\s*on public\.contact_roles for select to authenticated/i)
    expect(migration).not.toMatch(/for all to authenticated/i)
  })

  it('keys role visibility on the appointment’s matter', () => {
    // Not on the contact's household — otherwise a second engagement's
    // fiduciaries would be visible from the first.
    expect(migration).toMatch(/where m\.id = contact_roles\.matter_id/i)
  })

  it('grants nothing to anonymous callers', () => {
    expect(migration).not.toMatch(/to anon/i)
  })
})

describe('removing a person from one matter', () => {
  const migration = source(MIGRATION)

  it('detaches from the named matter instead of deleting the person', () => {
    expect(migration).toMatch(/create or replace function public\.delete_matter_contact/i)
    expect(migration).toMatch(/DELETE FROM public\.matter_contacts\s*WHERE contact_id = p_contact_id\s*AND matter_id = p_matter_id/i)
  })

  it('clears only that matter’s appointments', () => {
    expect(migration).toMatch(/DELETE FROM public\.contact_roles\s*WHERE contact_id = p_contact_id\s*AND matter_id = p_matter_id/i)
  })

  it('deletes the person only once no matter references them', () => {
    expect(migration).toMatch(/IF remaining_count = 0 THEN/i)
    // A standalone directory contact belongs to no matter by design and must
    // survive being detached from one.
    expect(migration).toMatch(/AND client_intake_id IS NOT NULL/i)
  })

  it('is reachable only by the service role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.delete_matter_contact\(uuid, uuid\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_matter_contact\(uuid, uuid\) TO service_role/i)
  })

  it('leaves the old function in place for a deploy that races the migration', () => {
    expect(migration).not.toMatch(/drop function[\s\S]{0,60}delete_intake_contact/i)
  })

  it('is what both delete routes call, keyed on the matter', () => {
    for (const route of [
      'app/api/admin/matters/[id]/contacts/route.ts',
      'app/api/admin/matters/[id]/design-sheet/contacts/route.ts',
    ]) {
      const text = source(route)
      expect(text).toMatch(/rpc\('delete_matter_contact', \{\s*p_contact_id: contactId,\s*p_matter_id: matterId,/)
      expect(text).not.toContain('delete_intake_contact')
    }
  })
})
