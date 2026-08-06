import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('unified CRM hub', () => {
  it('exposes one CRM navigation entry and the five CRM workspaces', () => {
    const adminLayout = read('app/admin/AdminLayoutClient.tsx')
    const subnav = read('app/admin/crm/CrmSubnav.tsx')

    expect(adminLayout).toContain("{ href: '/admin/crm', label: 'CRM'")
    expect(adminLayout).not.toMatch(/label: '(Leads|People|Contacts|Campaigns)'/)
    for (const route of ['people', 'opportunities', 'activities', 'campaigns', 'sync']) {
      expect(subnav).toContain(`/admin/crm/${route}`)
    }
  })

  it('preserves legacy lead and contact URLs with framework redirects', async () => {
    const config = await import('../next.config.mjs')
    const redirectsFactory = config.default.redirects
    if (!redirectsFactory) throw new Error('Next.js redirects are not configured')
    const redirects = await redirectsFactory()

    expect(redirects).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '/admin/leads', destination: '/admin/crm/opportunities' }),
      expect.objectContaining({ source: '/admin/leads/:path*', destination: '/admin/crm/opportunities/:path*' }),
      expect.objectContaining({ source: '/admin/contacts', destination: '/admin/crm/people' }),
    ]))
  })

  it('uses authoritative source views for People and campaign eligibility', () => {
    expect(read('app/admin/crm/people/page.tsx')).toContain('fetchContactsDirectory')
    expect(read('app/api/admin/crm/campaigns/[id]/queue/route.ts')).toContain(".from('v_cornerstone_crm_people')")
    expect(read('lib/crm/campaignDispatch.ts')).toContain(".from('v_cornerstone_crm_people')")
    expect(fs.existsSync(path.join(process.cwd(), 'app/api/admin/crm/import-leads/route.ts'))).toBe(false)
  })

  it('expands, backfills, and bridges CRM writes idempotently', () => {
    const migration = read('supabase/migrations/20260902000000_unify_crm_hub.sql')

    expect(migration).toContain('with (security_invoker = true)')
    expect(read('supabase/migrations/20260901000000_cornerstone_crm_mailgun_campaigns.sql')).toContain('cornerstone_crm_people_client_intake_id_idx')
    expect(migration).toContain('cornerstone_crm_people_contact_id_idx')
    expect(migration).toContain('foreign key (client_intake_id) references public.client_intake(id) on delete cascade')
    expect(migration).toContain('cornerstone_crm_opportunities_intake_idx')
    expect(migration).toContain('cornerstone_crm_activities_source_key_idx')
    expect(migration).toContain('cornerstone_crm_sync_events_idempotency_idx')
    expect(migration).toContain("('public.cornerstone_crm_campaign_steps'::regclass, 'campaign steps', false)")
    expect(migration).toContain("'Cornerstone CRM staff read ' || policy_row.label")
    expect(migration).toContain('crm_current_user_is_staff')
    expect(migration).toContain('cornerstone_crm_campaign_deliveries_step_idx')
    expect(migration).toContain('Campaign recipient snapshots are immutable')
    expect(read('app/api/admin/crm/campaigns/[id]/queue/route.ts')).toContain('snapshot_email: person.email')
    expect(read('lib/crm/campaignDispatch.ts')).toContain('email: snapshotEmail')
    expect(migration).toContain("'needs_review'")
    expect(migration).toContain("'opportunity_created'")
    expect(migration).toContain('sync_crm_person_from_intake')
    expect(migration).toContain('sync_crm_person_from_contact')
    expect(migration).toContain('sync_crm_opportunity_from_matter')
    expect(migration).toContain('mirror_crm_opportunity_compatibility')
    expect(migration).toContain('sync_crm_activity_from_lead_activity')
    expect(migration).toContain('emit_crm_outbox_event')
    expect(migration).toContain("to_jsonb(new)->>'source_type' = 'opportunity_transition'")
    expect(migration).not.toMatch(/drop table(?: if exists)? public\.lead_activity/i)
  })
})
