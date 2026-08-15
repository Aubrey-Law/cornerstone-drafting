import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260928000000_open_matter_for_person.sql'
const ROUTE = 'app/api/admin/matters/open-for-person/route.ts'

describe('opening a matter for a person the firm already knows', () => {
  const migration = source(MIGRATION)

  it('takes a contact, not a name and email', () => {
    // create_matter_with_client always inserts a new person; this one reuses an
    // existing contacts row, which is the whole point.
    expect(migration).toMatch(/create or replace function public\.open_matter_for_person\(\s*p_contact_id uuid/i)
    expect(migration).toMatch(/RAISE EXCEPTION 'No such person: %'/i)
  })

  it('still creates the engagement its own intake', () => {
    // Decision §12.3: client_intake is per engagement, contacts is the person.
    expect(migration).toMatch(/INSERT INTO public\.client_intake \(/i)
    expect(migration).toMatch(/RETURNING id INTO v_intake_id/i)
  })

  it('declares the client before inserting the matter', () => {
    // The §17 ordering trap: sync_matter_contacts_from_matter fires on the
    // insert and would mint a second copy of the person otherwise.
    const declareAt = migration.indexOf("set_config('app.open_matter_self_contact_id', p_contact_id::text, true)")
    const insertAt = migration.indexOf('INSERT INTO public.matters (')
    expect(declareAt).toBeGreaterThan(-1)
    expect(insertAt).toBeGreaterThan(-1)
    expect(declareAt).toBeLessThan(insertAt)
  })

  it('scopes the declaration to the transaction and clears it', () => {
    // `true` is is_local — it cannot leak onto a pooled connection or outlive a
    // rollback.
    expect(migration).toMatch(/set_config\('app\.open_matter_self_contact_id', p_contact_id::text, true\)/)
    expect(migration).toMatch(/set_config\('app\.open_matter_self_contact_id', '', true\)/)
    // Including on the failure path, or a retry in the same transaction would
    // attach the wrong person.
    const exceptionBlock = migration.slice(migration.indexOf('EXCEPTION WHEN unique_violation'))
    expect(exceptionBlock).toMatch(/set_config\('app\.open_matter_self_contact_id', '', true\)/)
  })

  it('has the trigger honour the declaration instead of minting', () => {
    expect(migration).toMatch(/v_declared := nullif\(current_setting\('app\.open_matter_self_contact_id', true\), ''\)/)
    expect(migration).toMatch(/if v_declared is not null then\s*v_self_id := v_declared::uuid;\s*else/i)
  })

  it('still mints for a genuinely new client', () => {
    // The else branch has to keep working — most matters are for new people.
    expect(migration).toMatch(/v_self_id := public\.self_contact_for_intake\(new\.client_intake_id\);/)
  })

  it('carries the spouse and children but not the fiduciaries', () => {
    // Appointments belong to the engagement that made them; the new one
    // nominates its own.
    expect(migration).toMatch(/AND mc\.relationship_type IN \('spouse', 'child'\)/i)
    expect(migration).not.toMatch(/INSERT INTO public\.contact_roles/i)
  })

  it('carries from the person’s most recent other matter', () => {
    expect(migration).toMatch(/AND mc\.matter_id <> v_matter\.id\s*ORDER BY m\.created_at DESC/i)
  })

  it('resolves a repeated submission to one matter', () => {
    expect(migration).toMatch(/WHERE m\.creation_request_id = p_request_id/i)
  })

  it('declares the variable-conflict resolution the OUT columns force', () => {
    // matter_id/matter_number/client_intake_id shadow real columns, which makes
    // `ON CONFLICT (matter_id, contact_id)` ambiguous at runtime.
    expect(migration).toMatch(/#variable_conflict use_column/)
  })

  it('is service-role only', () => {
    expect(migration).toMatch(/RAISE EXCEPTION 'Service role required'/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.open_matter_for_person[\s\S]{0,120}FROM PUBLIC, anon, authenticated/i)
  })
})

describe('the route behind it', () => {
  const route = source(ROUTE)

  it('is admin-gated and validates the contact id', () => {
    expect(route).toMatch(/requireAdmin/)
    expect(route).toMatch(/UUID_RE\.test\(contactId\)/)
  })

  it('seeds the design sheet and the SLA checklist like the create route', () => {
    expect(route).toMatch(/ensureDesignSheetSeededFromIntake\(row\.matter_id\)/)
    expect(route).toMatch(/ensureMatterSlaTasks\(row\.matter_id/)
  })

  it('retries only a matter-number collision', () => {
    expect(route).toMatch(/if \(error\?\.code !== '23505'\) break/)
  })

  it('is reachable from the contacts panel', () => {
    const panel = source('app/admin/contacts/ContactSidePanel.tsx')
    expect(panel).toMatch(/\/api\/admin\/matters\/open-for-person/)
    // Keyed on the person, not on the engagement row.
    expect(panel).toMatch(/contactId: contact\.self_contact_id/)
  })
})
