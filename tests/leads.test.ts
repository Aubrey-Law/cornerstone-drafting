import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

/** The live definition of the list, which is a view rather than a page loader. */
const LEAD_LIST_VIEW = (() => {
  const dir = path.join(process.cwd(), 'supabase/migrations')
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort().reverse()) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8')
    if (sql.includes('create or replace view public.v_lead_list')) return sql
  }
  throw new Error('v_lead_list is not defined in any migration')
})()

describe('lead tracking source shape', () => {
  it('leads page lists lead-flow intakes', () => {
    const source = read('app/admin/leads/page.tsx')
    // The list is ranked and paged in the database now (20261014000000), so
    // which rows are lead-flow rows is stated once, in the view.
    expect(source).toContain('fetchLeadListPage')
    expect(source).toContain('isEsignConfigured')
    expect(read('lib/queries/leadList.ts')).toContain("from('v_lead_list')")
    expect(LEAD_LIST_VIEW).toContain('where ci.lead_status is not null')
  })

  it('lead creation inserts a standalone client_intake', () => {
    const route = read('app/api/admin/leads/route.ts')
    const service = read('lib/leads/createLead.ts')
    expect(route).toContain('requireAdmin')
    expect(route).toContain('createLead')
    expect(service).toContain("from('client_intake')")
    expect(service).toContain('engagement_fee_quoted')
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

  it('exposes lead-stage text and Word intake import routes', () => {
    const textRoute = read('app/api/admin/leads/[id]/parse-intake/route.ts')
    const docxRoute = read('app/api/admin/leads/[id]/parse-intake-docx/route.ts')
    expect(textRoute).toContain('parseAndSaveLeadIntakeDraft')
    expect(docxRoute).toContain('parseAndSaveLeadIntakeDraft')
    expect(docxRoute).toContain('extractDocxText')
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
  it('renders the editable field rail with grouped sections and no status field', () => {
    const source = read('components/leads/LeadFieldsRail.tsx')
    expect(source).toContain('Lead details')
    expect(source).toContain('w-[340px]')
    expect(source).toContain('LEAD_FIELD_GROUPS')
    expect(source).toContain('LeadReadinessDial')
    expect(source).toContain('Enter to save · Esc to cancel')
    expect(source).not.toContain('Matter status')
  })

  it('scores readiness from the shared field predicates plus the intake and engagement gates', () => {
    const source = read('lib/leads/readiness.ts')
    expect(source).toContain('FIELD_DEFINITIONS')
    expect(source).toContain('evaluateLeadRequirements')
    expect(source).toContain('lifecycle.has(definition.key)')
    expect(source).toContain("key: 'intake'")
    expect(source).toContain("key: 'engagement'")
  })

  it('edit/delete route exports PATCH and DELETE with a converted guard', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain('export async function DELETE')
    expect(source).toContain('409')
    expect(source).toContain('archiveLead')
  })

  it('delete route keeps archive as the default and destroys only on request', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('deleteLeadPermanently')
    expect(source).toContain('permanent === true')
    // Destroying a record is held to the administrator role; archiving is not.
    expect(source).toContain('requirePermanentDeletionRole')
    expect(source).toContain('requiresConfirmation')
  })

  it('bulk-delete route loops ids through archive or permanent delete', () => {
    const source = read('app/api/admin/leads/bulk-delete/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('archiveLead')
    expect(source).toContain('deleteLeadPermanently')
    expect(source).toContain('results')
  })

  it('archiveLead rejects hired matters, cancels pending envelopes, and archives the opportunity', () => {
    const source = read('lib/leads/removeLead.ts')
    expect(source).toContain('Hired matters cannot be removed from Leads')
    expect(source).toContain('cancelEnvelope')
    expect(source).toContain("relationship_status: 'lost'")
    expect(source).toContain("status: 'archived'")
  })

  it('leads client has selection, bulk delete, and a create-only lead dialog', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    const table = read('components/leads/LeadsTable.tsx')
    const editor = read('components/leads/LeadEditorDialog.tsx')
    expect(table).toContain('Checkbox')
    expect(source).toContain('bulk-delete')
    expect(source).toContain("method: 'PATCH'")
    // The dialog creates; editing an existing lead happens in the record panel,
    // which patches one validated field at a time.
    expect(editor).toContain('New lead')
    expect(editor).not.toContain('Edit lead')
  })
})

describe('lead status pipeline source shape', () => {
  it('shows compact pipeline insights based on existing lead and activity data', () => {
    const client = read('app/admin/leads/LeadsClient.tsx')
    const insights = read('components/leads/LeadPipelineInsights.tsx')
    expect(LEAD_LIST_VIEW).toContain('from public.lead_activity')
    expect(LEAD_LIST_VIEW).toContain('last_activity_at')
    expect(client).toContain('LeadPipelineInsights')
    expect(insights).toContain('Needs attention')
    expect(insights).toContain('Quoted pipeline')
  })

  it('keeps qualification fields on client_intake and in the transactional lead RPC', () => {
    const migration = read('supabase/migrations/20260731000001_lite_lead_pipeline_insights.sql')
    expect(migration).toContain('alter table public.client_intake')
    expect(migration).toContain('lead_urgency')
    expect(migration).toContain('taxable_estate')
    expect(migration).toContain('has_minor_children')
    expect(migration).toContain('qualification_notes')
    expect(migration).toContain('create or replace function public.update_lead_details')
  })

  it('leads page filters to lead-flow rows only', () => {
    expect(LEAD_LIST_VIEW).toContain('where ci.lead_status is not null')
    expect(LEAD_LIST_VIEW).toContain('left join public.matters m on m.id = ci.matter_id')
  })

  it('keeps declined leads on the list and gives them their own tab', () => {
    // A declined opportunity used to be dropped by the list filter, so it could
    // not be reviewed or reopened from anywhere in the app.
    expect(LEAD_LIST_VIEW).toMatch(/in \('lead', 'lost', 'declined'\)/)
    const client = read('app/admin/leads/LeadsClient.tsx')
    expect(client).toContain("{ value: 'declined', label: 'Declined' }")
    // Its tab count comes from the server summary, over the whole pipeline.
    expect(client).toContain('declined: summary.declined')
  })

  it('lead creation defaults to the lead status', () => {
    expect(read('lib/leads/createLead.ts')).toContain("lead_status: 'lead'")
  })

  it('conversion flips a lead to hired', () => {
    const source = read('supabase/migrations/20260713020824_lite_lead_details_notes.sql')
    expect(source).toContain("'hired'")
    expect(source).toContain('lead_status')
  })

  it('patch validates the lead status enum', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('leadStatus')
    expect(source).toContain("['lead', 'hired', 'lost']")
  })

  it('leads client has status filter tabs and a per-lead progress cell', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    const table = read('components/leads/LeadsTable.tsx')
    expect(table).toContain('LeadProgress')
    expect(source).toContain('FILTER_TABS')
    expect(table).toContain('View matter')
  })

  it('leads client derives a single next step per lead', () => {
    const source = read('components/leads/LeadsTable.tsx')
    expect(source).toContain('function nextStep')
    expect(source).toContain('send_intake')
    expect(source).toContain('send_engagement')
    expect(source).toContain('hire_matter')
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
    const table = read('components/leads/LeadsTable.tsx')
    expect(source).toContain('SendEngagementDialog')
    expect(table).toContain('provisionalLeadNumber')
  })
})
