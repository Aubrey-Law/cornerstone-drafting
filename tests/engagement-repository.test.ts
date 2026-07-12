import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260728000000_lite_engagement_agreements.sql',
)

describe('engagement persistence migration', () => {
  it('defines normalized agreement, revision, recipient, and webhook event tables', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    for (const table of [
      'engagement_agreements',
      'engagement_agreement_revisions',
      'engagement_agreement_recipients',
      'firma_webhook_events',
    ]) {
      expect(sql).toContain(`create table public.${table}`)
      expect(sql).toContain(`alter table public.${table} enable row level security`)
    }
  })

  it('enforces one owner and unique Firma request and event identifiers', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/check \(\(matter_id is not null\)::int \+ \(lead_id is not null\)::int = 1\)/)
    expect(sql).toMatch(/firma_request_id text unique/)
    expect(sql).toMatch(/event_id text not null unique/)
  })

  it('provides atomic send claiming and staff read/write policies', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('claim_engagement_agreement_send')
    expect(sql).toContain("status = 'ready'")
    expect(sql).toContain("status = 'sending'")
    expect(sql.match(/create policy "Staff manage engagement/g)?.length).toBe(4)
    expect(sql).toContain("u.role in ('attorney', 'admin', 'va', 'staff')")
  })
})

describe('engagement repository source shape', () => {
  it('uses an injected client and the atomic send RPC', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/engagement/repository.ts'), 'utf8')
    expect(source).toContain('client: SupabaseClient')
    expect(source).toContain("client.rpc('claim_engagement_agreement_send'")
    expect(source).not.toContain('getAdminClient')
    expect(source).not.toContain('createClient(')
  })
})
