import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261203000000_scheduler_integration_foundation.sql',
  'utf8',
)
const localSeed = readFileSync('supabase/seed.sql', 'utf8')
const externalRecordsPolicyPattern = /create policy[\s\S]+integration_external_records/i
const serviceOnlySeedException = localSeed.match(
  /revoke all on table([\s\S]*?)from anon, authenticated;/i,
)

describe('scheduler integration foundation migration', () => {
  it('ships both connectors disabled and keeps delivery records service-only', () => {
    expect(migration).toContain('lawmatics_appointment_sync_enabled boolean not null default false')
    expect(migration).toContain('statular_sync_enabled boolean not null default false')
    expect(migration).toContain('create table public.integration_external_records')
    expect(migration).toContain('alter table public.integration_external_records enable row level security')
    expect('create policy service_only on public.integration_external_records').toMatch(
      externalRecordsPolicyPattern,
    )
    expect(migration).not.toMatch(externalRecordsPolicyPattern)
  })

  it('enforces one external record per internal entity and kind', () => {
    expect(migration).toContain(
      'unique (provider, internal_entity_type, internal_entity_id, external_record_type)',
    )
    expect(migration).toContain('request_snapshot jsonb')
    expect(migration).toContain('request_hash text')
  })

  it('keeps integration tables out of local blanket browser grants', () => {
    expect(serviceOnlySeedException?.[1]).toContain('public.integration_settings')
    expect(serviceOnlySeedException?.[1]).toContain('public.integration_external_records')
  })
})
