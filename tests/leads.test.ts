import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

describe('lead tracking source shape', () => {
  it('leads page lists lead-flow intakes', () => {
    const source = read('app/admin/leads/page.tsx')
    expect(source).toContain("not('lead_status', 'is', null)")
    expect(source).toContain('isEsignConfigured')
  })

  it('lead creation inserts a standalone client_intake', () => {
    const source = read('app/api/admin/leads/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain("from('client_intake')")
    expect(source).toContain('engagement_fee_quoted')
  })

  it('lead engagement send guards converted and signed leads', () => {
    const source = read('app/api/admin/leads/[id]/engagement/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('501')
    expect(source).toContain('409')
    expect(source).toContain("engagement_status: 'sent'")
  })

  it('intake send supports lead intakes without a matter', () => {
    const source = read('app/api/admin/intake/send/route.ts')
    expect(source).toContain('intakeId')
    expect(source).toContain('matterId or intakeId is required')
  })

  it('conversion is idempotent and carries fee + engagement state', () => {
    const source = read('lib/matters/createFromIntake.ts')
    expect(source).toContain("rpc('convert_lead_to_matter'")
    expect(source).toContain('engagement_fee_quoted')
    expect(source).toContain('p_fee')
    expect(source).toContain('ensureDesignSheetSeededFromIntake')
  })

  it('webhook converts a signed lead into a matter', () => {
    const source = read('app/api/webhooks/esign/route.ts')
    expect(source).toContain('createMatterFromIntake')
    expect(source).toContain("from('client_intake')")
    expect(source).toContain('storeSignedEngagement')
  })
})

describe('lead edit and delete source shape', () => {
  it('edit/delete route exports PATCH and DELETE with a converted guard', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain('export async function DELETE')
    expect(source).toContain('409')
    expect(source).toContain('deleteLead')
  })

  it('bulk-delete route loops ids through deleteLead', () => {
    const source = read('app/api/admin/leads/bulk-delete/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('deleteLead')
    expect(source).toContain('results')
  })

  it('deleteLead rejects hired matters, cancels pending envelopes, and archives the opportunity', () => {
    const source = read('lib/leads/deleteLead.ts')
    expect(source).toContain('Hired matters cannot be removed from Leads')
    expect(source).toContain('cancelEnvelope')
    expect(source).toContain("relationship_status: 'lost'")
    expect(source).toContain("status: 'archived'")
    expect(source).not.toContain("from('client_intake').delete()")
  })

  it('leads client has selection, bulk delete, and an edit dialog', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('Checkbox')
    expect(source).toContain('bulk-delete')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('Edit lead')
  })
})

describe('lead status pipeline source shape', () => {
  it('shows compact pipeline insights based on existing lead and activity data', () => {
    const page = read('app/admin/leads/page.tsx')
    const client = read('app/admin/leads/LeadsClient.tsx')
    const insights = read('components/leads/LeadPipelineInsights.tsx')
    expect(page).toContain("from('lead_activity')")
    expect(page).toContain('last_activity_at')
    expect(client).toContain('LeadPipelineInsights')
    expect(insights).toContain('Needs attention')
    expect(insights).toContain('Quoted pipeline')
  })

  it('keeps qualification fields on client_intake and in the transactional lead RPC', () => {
    const migration = read('supabase/migrations/20260731000000_lite_lead_pipeline_insights.sql')
    expect(migration).toContain('alter table public.client_intake')
    expect(migration).toContain('lead_urgency')
    expect(migration).toContain('taxable_estate')
    expect(migration).toContain('has_minor_children')
    expect(migration).toContain('qualification_notes')
    expect(migration).toContain('create or replace function public.update_lead_details')
  })

  it('leads page filters to lead-flow rows only', () => {
    const source = read('app/admin/leads/page.tsx')
    expect(source).toContain("not('lead_status', 'is', null)")
    expect(source).toContain('matter_id')
  })

  it('lead creation defaults to the lead status', () => {
    expect(read('app/api/admin/leads/route.ts')).toContain("lead_status: 'lead'")
  })

  it('conversion flips a lead to hired', () => {
    const source = read('supabase/migrations/20260730000000_lite_lead_details_notes.sql')
    expect(source).toContain("'hired'")
    expect(source).toContain('lead_status')
  })

  it('patch validates the lead status enum', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('leadStatus')
    expect(source).toContain("['lead', 'hired', 'lost']")
  })

  it('leads client has status filter tabs and a status badge', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('LeadStatusBadge')
    expect(source).toContain('FILTER_TABS')
    expect(source).toContain('View matter')
  })
})

describe('engagement send form + spouse', () => {
  it('lead engagement route accepts spouse and upserts a spouse contact', () => {
    const source = read('app/api/admin/leads/[id]/engagement/route.ts')
    expect(source).toContain('spouseName')
    expect(source).toContain('spouseEmail')
    expect(source).toContain("relationship_type: 'spouse'")
    expect(source).toContain('createEngagementEnvelope')
  })

  it('matter engagement route passes the spouse from the pipeline', () => {
    const source = read('app/api/admin/matters/[id]/engagement/route.ts')
    expect(source).toContain('spouse_email')
    expect(source).toContain('spouse:')
  })

  it('leads client renders the send form and a provisional number', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('SendEngagementDialog')
    expect(source).toContain('provisionalNumber')
  })
})
