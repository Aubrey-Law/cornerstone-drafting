import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { mergeLeadFieldPatch, validateLeadDetails, validateLeadFieldPatch } from '@/lib/leads/details'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260713020824_lite_lead_details_notes.sql',
)
const snoozeMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260726021847_repository_security_remediation.sql',
)
const atomicFieldMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260812000000_lead_atomic_field_updates.sql',
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

const leadSnapshot = {
  id: 'lead-1',
  first_name: 'Jane',
  middle_name: 'Q',
  last_name: 'Doe',
  preferred_name: 'Janie',
  email: 'jane@example.com',
  phone: '617-555-0100',
  date_of_birth: '1980-04-03',
  address_line1: '10 Main St',
  address_line2: 'Unit 2',
  city: 'Boston',
  state: 'MA',
  zip: '02108',
  county: 'Suffolk',
  marital_status: 'married',
  practice_area: 'EP',
  lead_source: 'Referral',
  lead_status: 'lead' as const,
  engagement_fee_quoted: 4500,
  lead_urgency: 'high',
  taxable_estate: 2_500_000,
  has_minor_children: true,
  qualification_notes: 'Needs a trust review.',
  billing_type: null,
  legal_plan_member_id: null,
  legal_plan_service_start: null,
  legal_plan_service_end: null,
}

const spouseSnapshot = {
  first_name: 'John',
  middle_name: 'R',
  last_name: 'Doe',
  preferred_name: 'Jack',
  email: 'john@example.com',
  phone: '617-555-0199',
  date_of_birth: '1981-05-04',
}

describe('lead details validation', () => {
  it('accepts and normalizes complete client and spouse details', () => {
    expect(validateLeadDetails(completeInput)).toEqual({
      firstName: 'Jane', middleName: null, lastName: 'Doe', preferredName: null,
      email: 'jane@example.com', phone: '617-555-0100', dateOfBirth: '1980-04-03',
      addressLine1: '10 Main St', addressLine2: null, city: 'Boston', state: 'MA',
      zip: '02108', county: null, maritalStatus: 'married', practiceArea: 'EP',
      source: 'Referral', status: 'lead', fee: 4500, urgency: null,
      estimatedEstateValue: null, hasMinorChildren: null, qualificationNotes: null,
      legalPlan: null, legalPlanMemberId: null,
      legalPlanServiceStart: null, legalPlanServiceEnd: null,
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

  it('accepts the lean qualification fields', () => {
    const result = validateLeadDetails({
      ...completeInput,
      urgency: 'high',
      estimatedEstateValue: 2_500_000,
      hasMinorChildren: true,
      qualificationNotes: 'Needs a trust review.',
    })
    expect(result).toMatchObject({ urgency: 'high', estimatedEstateValue: 2_500_000, hasMinorChildren: true, qualificationNotes: 'Needs a trust review.' })
  })

  it('uses the same canonical practice-area values as matters', () => {
    expect(validateLeadDetails({ ...completeInput, practiceArea: 'PROBATE' }).practiceArea).toBe('Probate')
    expect(validateLeadDetails({ ...completeInput, practiceArea: 'Estate Planning - LP' }).practiceArea).toBe('EP-LP')
    expect(() => validateLeadDetails({ ...completeInput, practiceArea: 'Elder Law' })).toThrow(/practice area/i)
  })

  it.each(['prospect', 'converted', ''])('rejects invalid status %s', status => {
    expect(() => validateLeadDetails({ ...completeInput, status } as never)).toThrow(/status/i)
  })

  it('normalizes blank optional values and absent spouse to null', () => {
    const result = validateLeadDetails({ ...completeInput, fee: '', source: ' ', spouse: null })
    expect(result.fee).toBeNull()
    expect(result.source).toBeNull()
    expect(result.spouse).toBeNull()
  })

  it('merges a phone-only patch into the trusted lead and spouse snapshot', () => {
    expect(mergeLeadFieldPatch(leadSnapshot, spouseSnapshot, {
      field: 'phone',
      value: ' 617-555-0111 ',
    })).toEqual({
      firstName: 'Jane', middleName: 'Q', lastName: 'Doe', preferredName: 'Janie',
      email: 'jane@example.com', phone: '617-555-0111', dateOfBirth: '1980-04-03',
      addressLine1: '10 Main St', addressLine2: 'Unit 2', city: 'Boston', state: 'MA',
      zip: '02108', county: 'Suffolk', maritalStatus: 'married', practiceArea: 'EP',
      source: 'Referral', status: 'lead', fee: 4500, urgency: 'high',
      estimatedEstateValue: 2_500_000, hasMinorChildren: true,
      qualificationNotes: 'Needs a trust review.',
      legalPlan: null, legalPlanMemberId: null,
      legalPlanServiceStart: null, legalPlanServiceEnd: null,
      spouse: {
        firstName: 'John', middleName: 'R', lastName: 'Doe', preferredName: 'Jack',
        email: 'john@example.com', phone: '617-555-0199', dateOfBirth: '1981-05-04',
      },
    })
  })

  it('rejects status as an inline-edit field', () => {
    expect(() => mergeLeadFieldPatch(leadSnapshot, spouseSnapshot, {
      field: 'status',
      value: 'lost',
    } as never)).toThrow()
  })

  it('rejects a partial patch that omits its value', () => {
    expect(() => mergeLeadFieldPatch(
      leadSnapshot,
      spouseSnapshot,
      { field: 'phone' } as never,
    )).toThrow()
  })

  it('validates the complete merged object so required identity cannot be erased', () => {
    expect(() => mergeLeadFieldPatch(leadSnapshot, spouseSnapshot, {
      field: 'firstName',
      value: ' ',
    })).toThrow(/first name is required/i)
  })

  it('validates and normalizes one field without requiring a mutable row snapshot', () => {
    expect(validateLeadFieldPatch({ field: 'email', value: ' JANE@EXAMPLE.COM ' })).toEqual({
      field: 'email',
      value: 'jane@example.com',
    })
    expect(validateLeadFieldPatch({ field: 'address', value: {
      addressLine1: ' 10 Main St ',
      addressLine2: '',
      city: ' Boston ',
      state: ' MA ',
      zip: '02108',
      county: '',
    } })).toEqual({
      field: 'address',
      value: {
        addressLine1: '10 Main St',
        addressLine2: null,
        city: 'Boston',
        state: 'MA',
        zip: '02108',
        county: null,
      },
    })
  })
})

describe('legal plan billing fields', () => {
  it('accepts every plan carrier and rejects an unknown one', () => {
    for (const plan of ['metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan']) {
      expect(validateLeadFieldPatch({ field: 'legalPlan', value: plan })).toEqual({
        field: 'legalPlan',
        value: plan,
      })
    }
    expect(() => validateLeadFieldPatch({ field: 'legalPlan', value: 'aetna' }))
      .toThrow(/legal plan/i)
  })

  it('still accepts flat_fee so a matter that came back flat fee round-trips', () => {
    expect(validateLeadFieldPatch({ field: 'legalPlan', value: 'flat_fee' }).value).toBe('flat_fee')
  })

  it('clears a plan and its member ID on blank input', () => {
    expect(validateLeadFieldPatch({ field: 'legalPlan', value: '' }).value).toBeNull()
    expect(validateLeadFieldPatch({ field: 'legalPlanMemberId', value: '  ' }).value).toBeNull()
  })

  it('trims a member ID and rejects a malformed service date', () => {
    expect(validateLeadFieldPatch({ field: 'legalPlanMemberId', value: ' MET-90210 ' }).value)
      .toBe('MET-90210')
    expect(validateLeadFieldPatch({ field: 'legalPlanServiceStart', value: '2026-01-01' }).value)
      .toBe('2026-01-01')
    expect(() => validateLeadFieldPatch({ field: 'legalPlanServiceEnd', value: '01/31/2026' }))
      .toThrow()
  })

  it('merges a plan patch without disturbing the rest of the lead', () => {
    const merged = mergeLeadFieldPatch(
      { ...leadSnapshot, practice_area: 'EP-LP' },
      spouseSnapshot,
      { field: 'legalPlanMemberId', value: 'MET-90210' },
    )
    expect(merged.legalPlanMemberId).toBe('MET-90210')
    expect(merged.legalPlan).toBeNull()
    expect(merged.email).toBe('jane@example.com')
    expect(merged.fee).toBe(4500)
  })

  it('carries existing plan values through an unrelated field edit', () => {
    const merged = mergeLeadFieldPatch(
      {
        ...leadSnapshot,
        practice_area: 'EP-LP',
        billing_type: 'metlife',
        legal_plan_member_id: 'MET-90210',
        legal_plan_service_start: '2026-01-01',
        legal_plan_service_end: '2026-12-31',
      },
      spouseSnapshot,
      { field: 'phone', value: '617-555-0111' },
    )
    expect(merged.legalPlan).toBe('metlife')
    expect(merged.legalPlanMemberId).toBe('MET-90210')
    expect(merged.legalPlanServiceStart).toBe('2026-01-01')
    expect(merged.legalPlanServiceEnd).toBe('2026-12-31')
  })
})

describe('lead next-action snooze migration', () => {
  const source = () => fs.readFileSync(snoozeMigrationPath, 'utf8').toLowerCase()

  it('adds the snooze timestamp and defines the atomic RPC', () => {
    const sql = source()
    expect(sql).toContain('lead_next_action_snoozed_until timestamptz')
    expect(sql).toContain('create or replace function public.snooze_lead_next_action')
    expect(sql).toContain('set search_path = pg_catalog, public')
  })

  it('accepts null as a clear while rejecting a non-null non-future timestamp', () => {
    const sql = source()
    expect(sql).toContain('if p_until is not null and p_until <= statement_timestamp() then')
    expect(sql).toContain("raise exception 'snooze time must be in the future'")
  })

  it('fails for a missing lead and a converted or lost lead while holding the row lock', () => {
    const sql = source()
    expect(sql).toMatch(/where id = p_lead_id\s+for update/)
    expect(sql).toMatch(/if not found then\s+raise exception 'lead not found'/)
    expect(sql).toContain("if v_lead.lead_status in ('hired', 'lost')")
    expect(sql).toContain("raise exception 'next action is unavailable for this lead'")
  })

  it('updates the snooze and inserts exactly one activity in the same function', () => {
    const sql = source()
    const functionBody = sql.slice(
      sql.indexOf('create or replace function public.snooze_lead_next_action'),
      sql.indexOf('revoke execute on function public.snooze_lead_next_action'),
    )
    expect(functionBody).toContain('set lead_next_action_snoozed_until = p_until')
    expect(functionBody.match(/insert into public\.lead_activity/g)).toHaveLength(1)
    expect(functionBody).toContain("'next_action_snooze_cleared'")
    expect(functionBody).toContain("'next action snooze cleared'")
    expect(functionBody).toContain("'next_action_snoozed'")
    expect(functionBody).toContain("'next action snoozed'")
  })

  it('requires the service role and validates the route actor as attorney or admin', () => {
    const sql = source()
    expect(sql).toContain(") <> 'service_role'")
    expect(sql).toMatch(/u\.id = p_actor_id\s+and u\.role in \('attorney', 'admin'\)/)
    expect(sql).toContain('revoke execute on function public.snooze_lead_next_action')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('grant execute on function public.snooze_lead_next_action')
    expect(sql).toContain('to service_role')
  })
})

describe('atomic lead field update migration', () => {
  const source = () => fs.readFileSync(atomicFieldMigrationPath, 'utf8').toLowerCase()

  it('defines a service-role-only field RPC with a closed field allowlist', () => {
    const sql = source()
    expect(sql).toContain('create or replace function public.update_lead_opportunity_field')
    expect(sql).toContain('p_field is null or p_field not in')
    for (const field of [
      'firstname', 'middlename', 'lastname', 'preferredname', 'email', 'phone',
      'dateofbirth', 'address', 'maritalstatus', 'practicearea', 'source', 'fee',
      'urgency', 'estimatedestatevalue', 'hasminorchildren', 'qualificationnotes', 'spouse',
    ]) {
      expect(sql).toContain(`'${field}'`)
    }
    expect(sql).toContain(") <> 'service_role'")
    expect(sql).toContain("u.id = p_actor_id and u.role in ('attorney', 'admin')")
    expect(sql).toContain('revoke execute on function public.update_lead_opportunity_field')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
  })

  it('rejects null or non-object address values before inspecting address keys', () => {
    const sql = source()
    const addressGuard = sql.slice(
      sql.indexOf("if p_field = 'address' then"),
      sql.indexOf("if p_field = 'spouse' then"),
    )
    expect(addressGuard).toContain("if v_is_null or jsonb_typeof(p_value) <> 'object' then")
    expect(addressGuard.indexOf("if v_is_null or jsonb_typeof(p_value) <> 'object' then"))
      .toBeLessThan(addressGuard.indexOf('jsonb_each(p_value)'))
  })

  it('locks the lead and opportunity before applying the requested field', () => {
    const sql = source()
    const leadLock = sql.indexOf('where id = p_lead_id for update')
    const matterLock = sql.indexOf('where id = v_lead.matter_id for update')
    const update = sql.indexOf('update public.client_intake set')
    expect(leadLock).toBeGreaterThan(-1)
    expect(matterLock).toBeGreaterThan(leadLock)
    expect(update).toBeGreaterThan(matterLock)
    expect(sql).toContain("v_matter.relationship_status = 'hired'")
    expect(sql).toContain("raise exception 'lead already converted")
  })

  it('updates disjoint scalar fields from the locked row rather than a full client snapshot', () => {
    const sql = source()
    expect(sql).toContain("phone = case when p_field = 'phone'")
    expect(sql).toContain("lead_source = case when p_field = 'source'")
    expect(sql).toContain('else phone end')
    expect(sql).toContain('else lead_source end')
    expect(sql).not.toContain('p_details')
  })

  it('serializes spouse upsert or removal behind the same lead lock and leaves spouse untouched for scalar fields', () => {
    const sql = source()
    const leadLock = sql.indexOf('where id = p_lead_id for update')
    const spouseGuard = sql.indexOf("if p_field = 'spouse' then")
    const spouseDelete = sql.indexOf('delete from public.contacts', spouseGuard)
    const spouseUpsert = sql.indexOf('insert into public.contacts', spouseGuard)
    expect(spouseGuard).toBeGreaterThan(leadLock)
    expect(spouseDelete).toBeGreaterThan(spouseGuard)
    expect(spouseUpsert).toBeGreaterThan(spouseGuard)
    expect(sql).toContain("on conflict (client_intake_id) where relationship_type = 'spouse'")
  })

  it('returns the locked lead, committed spouse state, and exactly one audit row atomically', () => {
    const sql = source()
    const functionBody = sql.slice(
      sql.indexOf('create or replace function public.update_lead_opportunity_field'),
      sql.indexOf('revoke execute on function public.update_lead_opportunity_field'),
    )
    expect(functionBody.match(/insert into public\.lead_activity/g)).toHaveLength(1)
    expect(functionBody).toContain("'details_updated'")
    expect(functionBody).toContain("'lead', to_jsonb(v_lead)")
    expect(functionBody).toContain("'spouse', v_spouse")
    expect(functionBody).toContain("'activity', to_jsonb(v_activity)")
  })

  it('defines a service-role-only status RPC with a closed non-hiring transition set', () => {
    const sql = source()
    expect(sql).toContain('create or replace function public.update_lead_opportunity_status')
    expect(sql).toContain("p_status is null or p_status not in ('lead', 'lost')")
    expect(sql).toContain(") <> 'service_role'")
    expect(sql).toContain("u.id = p_actor_id and u.role in ('attorney', 'admin')")
    expect(sql).toContain('revoke execute on function public.update_lead_opportunity_status')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('grant execute on function public.update_lead_opportunity_status')
    expect(sql).toContain('to service_role')
  })

  it('locks the lead and linked opportunity before changing only status fields', () => {
    const sql = source()
    const functionBody = sql.slice(
      sql.indexOf('create or replace function public.update_lead_opportunity_status'),
      sql.indexOf('revoke execute on function public.update_lead_opportunity_status'),
    )
    const leadLock = functionBody.indexOf('where id = p_lead_id for update')
    const matterLock = functionBody.indexOf('where id = v_lead.matter_id for update')
    expect(leadLock).toBeGreaterThan(-1)
    expect(matterLock).toBeGreaterThan(leadLock)
    expect(functionBody).toContain("if v_lead.lead_status = 'hired'")
    expect(functionBody).toContain("raise exception 'lead already converted")
    expect(functionBody).toContain('update public.matters')
    expect(functionBody).toContain('relationship_status = p_status')
    expect(functionBody).toContain('update public.client_intake')
    expect(functionBody).toContain('lead_status = p_status')
    expect(functionBody).not.toContain('p_details')
    expect(functionBody).not.toContain('update public.contacts')
    expect(functionBody).not.toContain('insert into public.contacts')
    expect(functionBody).not.toContain('delete from public.contacts')
  })

  it('audits and returns committed status, spouse, and activity from one transaction', () => {
    const sql = source()
    const functionBody = sql.slice(
      sql.indexOf('create or replace function public.update_lead_opportunity_status'),
      sql.indexOf('revoke execute on function public.update_lead_opportunity_status'),
    )
    expect(functionBody).toContain("set_config('app.actor_id', p_actor_id::text, true)")
    expect(functionBody.match(/insert into public\.lead_activity/g)).toHaveLength(1)
    expect(functionBody).toContain("'status_changed'")
    expect(functionBody).toContain("'lead', to_jsonb(v_lead)")
    expect(functionBody).toContain("'spouse', v_spouse")
    expect(functionBody).toContain("'activity', to_jsonb(v_activity)")
  })
})

describe('lead details and notes migration', () => {
  it('validates the verified service-route actor before audit attribution', () => {
    const source = fs.readFileSync(migrationPath, 'utf8')
    expect(source).toMatch(/auth\.role\(\) = 'service_role'[\s\S]*public\.users u where u\.id = p_actor_id[\s\S]*u\.role in \('attorney', 'admin'\)/)
    expect(source).toContain('v_actor_id := p_actor_id')
  })
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

  it('defines a service-role-only atomic lead conversion RPC', () => {
    const source=sql()
    expect(source).toContain('create or replace function public.convert_lead_to_matter')
    expect(source).toContain("auth.role() <> 'service_role'")
    expect(source).toContain('for update')
    expect(source).toContain('insert into public.matters')
    expect(source).toContain('insert into public.matter_details')
    expect(source).toContain("lead_status = 'hired'")
    expect(source).toContain('grant execute on function public.convert_lead_to_matter')
    expect(source).toContain('to service_role')
    expect(source).toContain('revoke execute on function public.convert_lead_to_matter')
    expect(source).toContain('from public')
    expect(source).toContain('from authenticated')
  })
})
