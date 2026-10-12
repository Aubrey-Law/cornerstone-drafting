import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('unified CRM hub', () => {
  it('links directly to Leads while preserving the CRM workspaces', () => {
    const adminLayout = read('app/admin/adminNav.ts')
    const subnav = read('app/admin/crm/CrmSubnav.tsx')

    expect(adminLayout).toContain("{ href: '/admin/crm/opportunities', label: 'Leads'")
    expect(adminLayout).toContain("label: 'People'")
    expect(adminLayout).toContain("label: 'Activities'")
    expect(read('app/admin/crm/layout.tsx')).not.toContain('CrmSubnav')
    for (const route of ['people', 'opportunities', 'activities']) {
      expect(subnav).toContain(`/admin/crm/${route}`)
    }
  })

  it('has no campaign UI or API surface', () => {
    const subnav = read('app/admin/crm/CrmSubnav.tsx')
    expect(subnav).not.toContain('/admin/crm/campaigns')
    expect(subnav).not.toContain('/admin/crm/sync')

    // Sync stays in Settings; campaigns are gone entirely.
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/settings/sync/page.tsx'))).toBe(true)
    const settings = read('app/admin/settings/settingsNav.ts')
    expect(settings).toContain('/admin/settings/sync')
    expect(settings).not.toContain('/admin/settings/campaigns')

    for (const gone of [
      'app/admin/settings/campaigns',
      'app/api/admin/crm/campaigns',
      'app/api/cron/crm-campaigns',
      'app/api/webhooks/mailgun',
      'app/api/unsubscribe',
      'lib/crm/campaignDispatch.ts',
      'lib/crm/campaignPolicy.ts',
      'lib/crm/mailgunCampaigns.ts',
      // The consent record outlived the campaigns for a while; with nothing
      // left to send, it went too.
      'lib/crm/consent.ts',
      'components/crm/MarketingProfileCard.tsx',
      'app/api/admin/crm/profiles',
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), gone))).toBe(false)
    }
  })

  it('asks for consent nowhere the firm can no longer market from', () => {
    // The opt-in/opt-out UI gated a nurture send that no longer exists, so it
    // was collecting a permission nothing could act on.
    for (const surface of [
      'app/admin/contacts/ContactSidePanel.tsx',
      'app/admin/leads/[id]/LeadDetailClient.tsx',
      'app/admin/matters/[id]/MatterDetailClient.tsx',
      'app/admin/matters/[id]/page.tsx',
      'app/admin/matters/[id]/tabs/messages.tsx',
      'app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx',
    ]) {
      expect(read(surface)).not.toMatch(/marketing|nurture/i)
    }
  })

  it('drops the marketing consent columns, and the view that selected them', () => {
    const migration = read('supabase/migrations/20261210000000_drop_crm_marketing_consent.sql')

    for (const column of [
      'marketing_status',
      'marketing_segment',
      'topic_preferences',
      'preferred_frequency',
      'consent_source',
      'consent_captured_at',
      'consent_captured_by',
      'unsubscribed_at',
      'campaign_opt_out',
    ]) {
      expect(migration).toContain(`drop column if exists ${column}`)
      expect(read('packages/db-types/src/supabase.generated.ts')).not.toContain(`  ${column}: `)
    }

    // A view cannot be `create or replace`d into dropping a column, and a view
    // still selecting one blocks the drop — so the recreate has to come first.
    expect(migration.indexOf('drop view if exists public.v_cornerstone_crm_people'))
      .toBeLessThan(migration.indexOf('alter table public.cornerstone_crm_people'))
    expect(migration).toContain('create view public.v_cornerstone_crm_people')
    expect(migration).toContain('grant select on public.v_cornerstone_crm_people')
  })

  it('leaves the campaign tables to their own migration', () => {
    // The consent migration deliberately stopped at the columns. Asserting no
    // DDL there touches the recipients table, rather than that the name never
    // appears — its header comment names it, which is the point.
    const migration = read('supabase/migrations/20261210000000_drop_crm_marketing_consent.sql')
    expect(migration).not.toMatch(/(alter|drop) table[^\n]*cornerstone_crm_campaign_recipients/i)
    expect(migration).not.toMatch(/drop column[^\n]*snapshot_marketing_status/i)
  })

  it('drops the campaign tables in reverse dependency order, without CASCADE', () => {
    const migration = read('supabase/migrations/20261211000000_drop_crm_campaign_tables.sql')
    const types = read('packages/db-types/src/supabase.generated.ts')

    // Every foreign key points leftwards in this list, so each table is gone
    // before the one it references — which is what makes CASCADE unnecessary,
    // and CASCADE is what would let this take something it never named.
    const order = [
      'cornerstone_crm_campaign_events',
      'cornerstone_crm_campaign_deliveries',
      'cornerstone_crm_campaign_dispatches',
      'cornerstone_crm_campaign_recipients',
      'cornerstone_crm_campaign_steps',
      'cornerstone_crm_campaigns',
    ]
    const positions = order.map(table => {
      const at = migration.indexOf(`drop table if exists public.${table};`)
      expect(at).toBeGreaterThan(-1)
      return at
    })
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(migration).not.toMatch(/drop table[^\n]*cascade/i)
    for (const table of order) expect(types).not.toContain(`      ${table}: {`)
  })

  it('takes the campaign-only functions but not the shared outbox one', () => {
    const migration = read('supabase/migrations/20261211000000_drop_crm_campaign_tables.sql')

    // A table's trigger goes with the table; the trigger function does not.
    expect(migration).toContain('drop function if exists public.enforce_crm_recipient_snapshot_immutable()')
    expect(migration).toContain('drop function if exists public.claim_crm_campaign_deliveries(uuid, integer)')
    expect(read('packages/db-types/src/supabase.generated.ts')).not.toContain('claim_crm_campaign_deliveries')

    // ...and the function drops have to come AFTER the tables. While the table
    // stands, its trigger is a dependency Postgres refuses to drop the function
    // out from under (SQLSTATE 2BP01), which failed the first draft of this
    // migration on its first statement.
    expect(migration.indexOf('drop table if exists public.cornerstone_crm_campaign_recipients'))
      .toBeLessThan(migration.indexOf('drop function if exists public.enforce_crm_recipient_snapshot_immutable'))

    // `emit_crm_outbox_event` still backs people and activities, and the outbox
    // itself still has readers — neither is this migration's to take.
    expect(migration).not.toMatch(/drop function[^\n]*emit_crm_outbox_event/i)
    expect(migration).not.toMatch(/(drop|delete from)[^\n]*cornerstone_crm_sync_events/i)
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
      expect.objectContaining({ source: '/admin/crm/sync', destination: '/admin/settings/sync' }),
    ]))
  })

  it('uses the authoritative source view for People', () => {
    expect(read('app/admin/crm/people/page.tsx')).toContain('fetchContactsDirectory')
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
    expect(migration).toContain("'Cornerstone CRM staff read ' || policy_row.label")
    expect(migration).toContain('crm_current_user_is_staff')
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
