import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20261010000000_matter_stage_totals.sql'

describe('matter stage totals view', () => {
  it('closes each visit with the next transition and leaves the newest open', () => {
    const migration = read(MIGRATION)

    // lead() over the matter's transitions gives the end of each visit; the
    // newest row has no follower and is still running, hence coalesce to now().
    expect(migration).toMatch(/lead\(h\.entered_at\) over \(\s*partition by h\.matter_id\s*order by h\.entered_at, h\.id\s*\)/)
    expect(migration).toContain('coalesce(o.exited_at, now())')
  })

  it('counts in business days, the same unit the aging board already shows', () => {
    const migration = read(MIGRATION)

    // Mixing calendar and business days in adjacent numbers would misread.
    expect(migration).toContain('public.business_days_elapsed(o.entered_at, coalesce(o.exited_at, now()))')
    expect(read('supabase/migrations/20260711000000_lite_matter_aging.sql'))
      .toContain('CREATE OR REPLACE FUNCTION public.business_days_elapsed(')
  })

  it('aggregates visits per matter and stage', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain('count(*)::int as visits')
    expect(migration).toContain('group by o.matter_id, m.client_intake_id, o.stage')
  })

  it('exposes client_intake_id so lead rows on the board can join', () => {
    const migration = read(MIGRATION)

    // v_pipeline_aging keys matter rows by matter id and lead rows by intake id.
    expect(migration).toContain('m.client_intake_id')
    expect(migration).toContain('join public.matters m on m.id = o.matter_id')
  })

  it('keeps RLS in force and grants read only', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain('with (security_invoker = true)')
    expect(migration).toContain('grant select on public.v_matter_stage_totals to authenticated, service_role')
    expect(migration).not.toMatch(/grant[^\n]*\b(insert|update|delete)\b[^\n]*v_matter_stage_totals/)
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })
})

describe('aging board reader', () => {
  it('matches totals by either key and degrades without them', () => {
    const source = read('lib/queries/pipelineAging.ts')

    expect(source).toContain("from('v_matter_stage_totals')")
    expect(source).toContain('matter_id.in.')
    expect(source).toContain('client_intake_id.in.')
    // Supporting detail: the board must still render if the view is missing.
    expect(source).toContain("console.warn('stage totals unavailable:'")
    expect(source).toMatch(/return rows\s*\n\s*}/)
  })
})
