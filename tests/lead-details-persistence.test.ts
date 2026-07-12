import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { validateLeadDetails } from '@/lib/leads/details'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260730000000_lite_lead_details_notes.sql',
)

const completeInput = {
  firstName: '  Jane ',
  middleName: ' ',
  lastName: ' Doe  ',
  preferredName: '',
  email: ' JANE@example.com ',
  phone: ' 617-555-0100 ',
  dateOfBirth: '1980-04-03',
  addressLine1: ' 10 Main St ',
  addressLine2: '',
  city: ' Boston ',
  state: ' MA ',
  zip: '02108',
  county: '',
  maritalStatus: 'married',
  practiceArea: ' ep ',
  source: ' Referral ',
  status: 'lead' as const,
  fee: 4500,
  spouse: {
    firstName: ' John ',
    middleName: '',
    lastName: ' Doe ',
    preferredName: '',
    email: 'john@example.com',
    phone: '',
    dateOfBirth: '',
  },
}

describe('lead details validation', () => {
  it('accepts and normalizes complete client and spouse details', () => {
    expect(validateLeadDetails(completeInput)).toEqual({
      firstName: 'Jane', middleName: null, lastName: 'Doe', preferredName: null,
      email: 'jane@example.com', phone: '617-555-0100', dateOfBirth: '1980-04-03',
      addressLine1: '10 Main St', addressLine2: null, city: 'Boston', state: 'MA',
      zip: '02108', county: null, maritalStatus: 'married', practiceArea: 'EP',
      source: 'Referral', status: 'lead', fee: 4500,
      spouse: { firstName: 'John', middleName: null, lastName: 'Doe', preferredName: null,
        email: 'john@example.com', phone: null, dateOfBirth: null },
    })
  })

  it.each(['bad', '@example.com', 'a@'])('rejects malformed email %s', email => {
    expect(() => validateLeadDetails({ ...completeInput, email })).toThrow(/email/i)
  })

  it('rejects malformed spouse emails', () => {
    expect(() => validateLeadDetails({ ...completeInput, spouse: { ...completeInput.spouse, email: 'bad' } })).toThrow(/email/i)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid fee %s', fee => {
    expect(() => validateLeadDetails({ ...completeInput, fee })).toThrow(/fee/i)
  })

  it.each(['prospect', 'converted', ''])('rejects invalid status %s', status => {
    expect(() => validateLeadDetails({ ...completeInput, status })).toThrow(/status/i)
  })

  it('normalizes blank optional values and absent spouse to null', () => {
    const result = validateLeadDetails({ ...completeInput, fee: '', source: ' ', spouse: null })
    expect(result.fee).toBeNull()
    expect(result.source).toBeNull()
    expect(result.spouse).toBeNull()
  })
})

describe('lead details and notes migration', () => {
  const sql = () => fs.readFileSync(migrationPath, 'utf8').toLowerCase()

  it('defines note tables, constraints, RLS, and staff policies', () => {
    const source = sql()
    expect(source).toContain('create table public.lead_notes')
    expect(source).toContain('create table public.lead_meeting_notes')
    expect(source).toContain("check (source in ('manual', 'granola'))")
    expect(source).toContain('unique index')
    expect(source).toContain('(lead_id, granola_note_id)')
    expect(source.match(/enable row level security/g)).toHaveLength(2)
    expect(source).toContain("u.role in ('attorney', 'admin', 'va', 'staff')")
    expect(source).toContain("u.role = 'admin'")
    expect(source).toContain('actor_id = (select auth.uid())')
  })

  it('locks and rejects converted leads in the transactional RPC', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.update_lead_details')
    expect(source).toContain('for update')
    expect(source).toMatch(/matter_id\s+is\s+not\s+null/)
    expect(source).toContain('lead already converted')
  })

  it('updates intake, upserts or deletes spouse, and records one activity', () => {
    const source = sql()
    expect(source).toContain('update public.client_intake')
    expect(source).toContain('insert into public.contacts')
    expect(source).toContain('on conflict (client_intake_id) where relationship_type = \'spouse\'')
    expect(source).toContain("delete from public.contacts")
    expect(source).toContain('insert into public.lead_activity')
    expect(source).toContain("'details_updated'")
  })

  it('limits RPC execution and performs an internal attorney/admin check', () => {
    const source = sql()
    expect(source).toContain('security definer')
    expect(source).toContain('set search_path = pg_catalog, public')
    expect(source).toContain("u.role in ('attorney', 'admin')")
    expect(source).toContain('revoke execute on function public.update_lead_details')
    expect(source).toContain('from public')
    expect(source).toContain('from anon')
    expect(source).toContain('to authenticated')
    expect(source).toContain('to service_role')
  })

  it('derives the actor from trusted JWT context and separates service-role calls', () => {
    const source = sql()
    expect(source).toContain("auth.role() = 'service_role'")
    expect(source).toContain('v_actor_id := auth.uid()')
    expect(source).toContain('p_actor_id is distinct from v_actor_id')
    expect(source).not.toContain("current_user <> 'service_role'")
    expect(source).toContain("u.id = v_actor_id and u.role in ('attorney', 'admin')")
  })

  it('fails closed on missing or malformed direct-RPC details', () => {
    const source = sql()
    expect(source).toContain("jsonb_typeof(p_details) <> 'object'")
    expect(source).toContain("nullif(trim(p_details->>'firstname'), '') is null")
    expect(source).toContain("nullif(trim(p_details->>'lastname'), '') is null")
    expect(source).toContain("jsonb_typeof(p_details->'firstname') <> 'string'")
    expect(source).toContain("jsonb_typeof(p_details->'lastname') <> 'string'")
    expect(source).toContain("nullif(trim(p_details->>'email'), '') is null")
    expect(source).toContain("jsonb_typeof(p_details->'email') <> 'string'")
    expect(source).toContain("p_details->>'email' !~*")
    expect(source).toContain("p_details->>'status' is null")
    expect(source).toContain("jsonb_typeof(p_details->'fee') not in ('number', 'null')")
    expect(source).toContain("jsonb_typeof(p_spouse) <> 'object'")
    expect(source).toContain("nullif(trim(p_spouse->>'firstname'), '') is null")
    expect(source).toContain("jsonb_typeof(p_spouse->'firstname') <> 'string'")
  })

  it('makes note authors immutable while retaining author/admin deletion', () => {
    const source = sql()
    expect(source).toContain('create function public.preserve_lead_note_provenance')
    expect(source).toContain('new.actor_id is distinct from old.actor_id')
    expect(source.match(/before update on public\.lead_(?:meeting_)?notes/g)).toHaveLength(2)
    expect(source.match(/actor_id = \(select auth\.uid\(\)\) or exists/g)).toHaveLength(2)
  })

  it('advances updated_at on both note tables', () => {
    const source = sql()
    expect(source).toContain('new.updated_at := statement_timestamp()')
    expect(source.match(/before update on public\.lead_(?:meeting_)?notes/g)).toHaveLength(2)
  })

  it('keeps spouse mutation and exactly one activity insert inside the RPC transaction', () => {
    const source = sql()
    const functionBody = source.slice(
      source.indexOf('create or replace function public.update_lead_details'),
      source.indexOf('revoke execute on function public.update_lead_details'),
    )
    expect(functionBody.match(/insert into public\.lead_activity/g)).toHaveLength(1)
    expect(functionBody).toContain("delete from public.contacts where client_intake_id = p_lead_id and relationship_type = 'spouse'")
    expect(functionBody).toContain("on conflict (client_intake_id) where relationship_type = 'spouse'")
    expect(functionBody.indexOf('delete from public.contacts')).toBeLessThan(functionBody.indexOf('insert into public.lead_activity'))
  })
})
