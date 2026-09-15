import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')
const migration = () => read('supabase/migrations/20260802000000_unify_leads_matters.sql')

describe('matter-owned lead lifecycle', () => {
  it('keeps migration versions unique and applies engagement hardening after function creation', () => {
    const names = fs.readdirSync('supabase/migrations').filter(name => /^\d+_.*\.sql$/.test(name))
    const versions = names.map(name => name.split('_', 1)[0])
    expect(new Set(versions).size).toBe(versions.length)
    expect(read('supabase/migrations/20260712104245_harden_engagement_agreement_rpc_privileges.sql')).toContain('to_regprocedure')
    expect(read('supabase/migrations/20260803000000_harden_engagement_rpc_privileges_after_creation.sql')).toContain('from public, anon')
    expect(read('supabase/seed.sql')).not.toContain('GRANT EXECUTE ON ALL FUNCTIONS')
  })

  it('creates a canonical relationship status and immutable history', () => {
    const sql = migration()
    expect(sql).toContain('relationship_status text not null')
    expect(sql).toContain("check (relationship_status in ('lead', 'hired', 'lost'))")
    expect(sql).toContain('create table if not exists public.matter_relationship_status_history')
    expect(sql).toContain('create index if not exists matter_relationship_status_history_matter_idx')
    expect(sql).toContain('drop policy if exists "Staff read matter relationship history"')
    expect(sql).toContain('where history.matter_id = m.id')
    expect(sql).toContain('record_matter_relationship_status_change')
    expect(sql).toContain('validate_matter_relationship_status_change')
    expect(sql).toContain("old.relationship_status = 'lost' and new.relationship_status = 'lead'")
    expect(sql).toContain('Reactivate the lost opportunity before hiring it')
    expect(sql).not.toContain('on public.matter_relationship_status_history for update')
    expect(sql).not.toContain('on public.matter_relationship_status_history for delete')
  })

  it('creates lead matters transactionally and leaves them unnumbered', () => {
    const sql = migration()
    expect(sql).toContain('create or replace function public.ensure_lead_matter()')
    expect(sql).toContain('after insert or update of lead_status, intake_sent_at, intake_completed_at, engagement_sent_at')
    expect(sql).toMatch(/null, v_stage, 'active', v_stage_entered_at, 'DEFAULT'/)
    expect(sql).toContain("relationship_status = 'hired'")
    expect(sql).toContain("set_config('app.actor_id', p_actor_id::text, true)")
  })

  it('keeps shared matter and aging views hired-only', () => {
    const sql = migration()
    expect(sql.match(/m\.relationship_status = 'hired'/g)?.length).toBeGreaterThanOrEqual(2)
    expect(sql).toContain("where m.status = 'active' and m.relationship_status = 'lead'")
  })

  it('backfills engagement agreements to matter ownership', () => {
    const sql = migration()
    expect(sql).toContain('set matter_id = ci.matter_id')
    expect(sql).toContain('lead_id = null')
    expect(sql).toContain('engagement_agreements_matter_owner_check check (matter_id is not null)')
    const repository = read('lib/engagement/repository.ts')
    expect(repository).toContain('matterId: string')
    expect(repository).toContain('lead_id: null')
    expect(repository).not.toContain('input.leadId')
  })

  it('gates drafting initialization and portal matter lookup to hired matters', () => {
    expect(read('lib/designSheet/ensureDesignSheetSeeded.ts')).toContain("data.relationship_status !== 'hired'")
    expect(read('lib/draftPayload/resolveMatterId.ts')).toContain(".eq('relationship_status', 'hired')")
    expect(read('lib/draftPayload/assemble.ts')).toContain("matter.relationship_status !== 'hired'")
    expect(read('lib/portal/getMatterForUser.ts')).toContain(".eq('relationship_status', 'hired')")
    expect(read('lib/documentSecurity.ts')).toContain(".eq('relationship_status', 'hired')")
  })

  it('creates Lawmatics lead opportunities in the intake persistence statement', () => {
    const importer = read('lib/lawmatics/importMatter.ts')
    expect(importer).toContain("lead_status: existingOpportunity?.relationship_status === 'hired' ? 'hired' : 'lead'")
    expect(importer).toContain('.insert(persistedIntakeRow)')
    expect(importer).toContain('.update(persistedIntakeRow)')
    expect(importer).toContain('Lawmatics lead import did not create its matter-owned opportunity')
  })

  it('uses matter-owned agreements from lead and matter routes', () => {
    expect(read('app/api/admin/leads/[id]/engagement-draft/route.ts')).toContain('.eq(\'matter_id\', opportunity.id)')
    expect(read('app/api/admin/leads/[id]/engagement-draft/route.ts')).toContain('matterId: opportunity.id')
    expect(read('app/api/admin/matters/[id]/engagement-draft/route.ts')).toContain('matterId,')
  })

  it('reconciles matter-owned provider callbacks into the versioned agreement', () => {
    const webhook = read('app/api/webhooks/esign/route.ts')
    expect(webhook).toContain("from('engagement_agreements')")
    expect(webhook).toContain("from('esign_webhook_events')")
    expect(webhook).toContain('completeWorkspaceAgreement')

    // Applying recipient state and keying the stored PDF per agreement moved
    // into the shared completion module, so the native signing path reconciles
    // identically rather than growing its own version.
    const completion = read('lib/esign/completion.ts')
    expect(completion).toContain("from('engagement_agreement_recipients')")
    expect(completion).toContain('signed/engagement-agreement-')
  })

  it('limits permanent deletion to admins and protects hired or signed records', () => {
    const deletion = read('lib/matters/deleteMatter.ts')
    expect(deletion).toContain("matter.relationship_status === 'hired'")
    expect(deletion).toContain(".eq('status', 'completed')")
    expect(read('app/api/admin/matters/[id]/route.ts')).toContain("profile?.role !== 'admin'")
  })
})
