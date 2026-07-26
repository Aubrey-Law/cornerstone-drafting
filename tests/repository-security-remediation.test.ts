import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')

function remediationSql(): string {
  const matches = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('_repository_security_remediation.sql'))

  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(migrationsDir, matches[0]), 'utf8').toLowerCase()
}

describe('repository security remediation migration', () => {
  it('restricts privileged RPC execution to the roles that need it', () => {
    const sql = remediationSql()

    expect(sql).toContain(
      'revoke execute on function public.delete_intake_contact(uuid, uuid)\n  from public, anon, authenticated',
    )
    expect(sql).toContain(
      'grant execute on function public.delete_intake_contact(uuid, uuid)\n  to service_role',
    )
    expect(sql).toContain(
      'revoke execute on function public.drafting_hub_draft_rollups(text[])\n  from public, anon, authenticated',
    )
    expect(sql).toContain(
      'grant execute on function public.drafting_hub_draft_rollups(text[])\n  to service_role',
    )
    expect(sql).toContain(
      'revoke execute on function public.mark_messages_read(text, text)\n  from public, anon',
    )
    expect(sql).toContain(
      'grant execute on function public.mark_messages_read(text, text)\n  to authenticated, service_role',
    )
  })

  it('authorizes message reads and protects contact-role cleanup', () => {
    const sql = remediationSql()

    expect(sql).toContain("p_reader_role <> 'client'")
    expect(sql).toContain('m.client_id = auth.uid()')
    expect(sql).toContain("raise exception 'matter access required'")

    const contactDelete = sql.indexOf('delete from public.contacts')
    const roleDelete = sql.indexOf('delete from public.contact_roles')
    expect(contactDelete).toBeGreaterThan(-1)
    expect(roleDelete).toBeGreaterThan(contactDelete)
    expect(sql).toContain('if deleted_count > 0 then')
  })

  it('hides meeting notes and installs lead snoozing under a unique version', () => {
    const sql = remediationSql()

    expect(sql).toContain("'meeting-notes'")
    expect(sql).toContain("'meeting_notes'")
    expect(sql).toContain("'meeting notes'")
    expect(sql).toContain('lead_next_action_snoozed_until timestamptz')
    expect(sql).toContain('create or replace function public.snooze_lead_next_action')
    expect(sql).toContain(
      'revoke execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)\n  from public, anon, authenticated',
    )
  })
})
