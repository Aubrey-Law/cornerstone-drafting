import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAgreementRevision } from '@/lib/engagement/repository'

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
    expect(sql).toContain('mark_engagement_agreement_ready')
    expect(sql).toMatch(/active_revision_id = p_revision_id[\s\S]*render_sha256 = p_render_sha256/)
    expect(sql).toContain("status = 'ready'")
    expect(sql).toMatch(/update public\.engagement_agreement_recipients[\s\S]*p_input_snapshot->'primary'[\s\S]*p_input_snapshot->'spouse'/)
    expect(sql).not.toContain('grant execute on function public.mark_engagement_agreement_ready(uuid, uuid, text) to authenticated')
    expect(sql).toContain('grant execute on function public.mark_engagement_agreement_ready(uuid, uuid, text) to service_role')
    expect(sql).toContain("status = 'sending'")
    expect(sql.match(/create policy "Staff manage engagement/g)?.length).toBe(4)
    expect(sql).toContain("u.role in ('attorney', 'admin', 'va', 'staff')")
  })

  it('binds active revisions to their agreement and blocks revisions after send', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('unique (agreement_id, id)')
    expect(sql).toMatch(/foreign key \(id, active_revision_id\)\s+references public\.engagement_agreement_revisions\(agreement_id, id\)/)
    expect(sql).toContain('guard_engagement_revision_insert')
    expect(sql).toContain("agreement_status not in ('draft', 'ready', 'failed')")
  })

  it('creates and activates revisions atomically under an agreement row lock', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('create_engagement_agreement_revision')
    expect(sql).toMatch(/from public\.engagement_agreements[\s\S]*for update/)
    expect(sql).toContain('max(revision_number)')
    expect(sql).toContain('active_revision_id = created_revision.id')
  })

  it('prevents sent lifecycle states from being reset to editable states', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('guard_engagement_agreement_status_transition')
    expect(sql).toContain("old.status = 'sending' and new.status in ('draft', 'ready')")
    expect(sql).toContain("old.status in ('sent', 'viewed', 'partially_signed', 'completed', 'cancelled', 'expired')")
    expect(sql).toContain("new.status in ('draft', 'ready', 'failed')")
  })

  it('freezes revision rows and active revision selection after sending starts', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('guard_engagement_revision_mutation')
    expect(sql).toContain('before update or delete on public.engagement_agreement_revisions')
    expect(sql).toContain("parent_status in ('sending', 'sent', 'viewed', 'partially_signed', 'completed', 'cancelled', 'expired')")
    expect(sql).toContain('new.active_revision_id is distinct from old.active_revision_id')
    expect(sql).toContain("old.status not in ('draft', 'ready', 'failed')")
  })
})

describe('engagement repository source shape', () => {
  it('passes the exact validated signer snapshot into the single atomic revision RPC', async () => {
    const snapshot = { practiceArea:'EP', clientMode:'couple', agreementDate:'2026-07-12', primary:{name:'Edited Primary',email:'EDITED@EXAMPLE.COM'}, spouse:{name:'Edited Spouse',email:'SPOUSE@EXAMPLE.COM'}, legalPlan:null, fee:{amount:1,paymentTerms:'Due'}, scopeKey:'standard', optionalClauseKeys:[], emailMessage:'', expirationHours:72 }
    const single = vi.fn().mockResolvedValue({ data:{ id:'r2' }, error:null })
    const rpc = vi.fn().mockReturnValue({ single })
    await createAgreementRevision({ rpc } as never, 'a1', { inputSnapshot:snapshot as never, renderSha256:'hash', masterVersion:'1' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('create_engagement_agreement_revision', expect.objectContaining({ p_agreement_id:'a1', p_input_snapshot:snapshot }))
  })

  it('uses an injected client and the atomic send RPC', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/engagement/repository.ts'), 'utf8')
    expect(source).toContain('client: SupabaseClient')
    expect(source).toContain("client.rpc('claim_engagement_agreement_send'")
    expect(source).toContain("client.rpc('create_engagement_agreement_revision'")
    expect(source).not.toContain("client.from('engagement_agreement_revisions').insert")
    expect(source).toContain('verifyRevisionApproval(input.approvalToken')
    expect(source).toContain('p_approval_nonce: approval.claims.nonce')
    expect(source).not.toContain('approvalNonce: string')
    expect(source).not.toContain('getAdminClient')
    expect(source).not.toContain('createClient(')
  })
})
