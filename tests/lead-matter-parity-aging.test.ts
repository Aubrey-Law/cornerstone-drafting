import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('lead and matter field parity', () => {
  const migration = () => read('supabase/migrations/20260801010000_lead_matter_field_parity_and_aging.sql')

  it('carries shared lead qualification data into matter details atomically', () => {
    const source = migration()
    for (const field of [
      'practice_area',
      'flat_fee_amount',
      'est_estate_value',
      'referral_source',
      'urgency',
      'matter_status_notes',
      'jurisdiction_state',
      'jurisdiction_county',
    ]) expect(source).toContain(field)
    expect(source).toContain('v_lead.taxable_estate')
    expect(source).toContain('v_lead.lead_source')
    expect(source).toContain('v_lead.lead_urgency')
    expect(source).toContain('v_lead.qualification_notes')
  })

  it('normalizes practice area at both shared data boundaries', () => {
    const source = migration()
    expect(source).toContain('create or replace function public.normalize_shared_practice_area()')
    expect(source).toContain('normalize_client_intake_practice_area')
    expect(source).toContain('normalize_matter_details_practice_area')
    expect(source).toContain("new.practice_area := 'Probate'")
  })

  it('uses one aging view for open leads and active matters', () => {
    const migrationSource = migration()
    const querySource = read('lib/queries/pipelineAging.ts')
    expect(migrationSource).toContain('create or replace view public.v_pipeline_aging')
    expect(migrationSource).toContain("ci.lead_status = 'lead' and ci.matter_id is null")
    expect(migrationSource).toContain("sn.entity = 'lead'")
    expect(querySource).toContain("from('v_pipeline_aging')")
  })

  it('routes each aging row to its lead or matter details page', () => {
    const source = read('app/admin/pipeline/aging/MatterAgingClient.tsx')
    expect(source).toContain("row.entity === 'lead' ? `/admin/crm/opportunities/${row.id}` : `/admin/matters/${row.id}`")
    expect(source).toContain('entity: target.entity')
  })
})
