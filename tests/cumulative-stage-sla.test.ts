import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20261011000000_cumulative_stage_sla.sql'

describe('cumulative stage SLA migration', () => {
  it('adds a configurable second threshold seeded from the per-visit budget', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain('add column if not exists cumulative_sla_days int')
    expect(migration).toContain('set cumulative_sla_days = sla_days * 2')
    // Only fills nulls, so re-running cannot clobber a hand-tuned value.
    expect(migration).toContain('where sla_days is not null and cumulative_sla_days is null')
  })

  it('turns a row red on either the per-visit or the cumulative breach', () => {
    const migration = read(MIGRATION)

    const redOnCumulative =
      /when x\.cumulative_sla_days is not null and x\.cumulative_days > x\.cumulative_sla_days then 'red'/g
    // Both arms of the union — matters and leads.
    expect(migration.match(redOnCumulative)).toHaveLength(2)

    const overdue = /\(x\.sla_days is not null and x\.days_in_stage > x\.sla_days\)\s*\n\s*or \(x\.cumulative_sla_days is not null and x\.cumulative_days > x\.cumulative_sla_days\)/g
    expect(migration.match(overdue)).toHaveLength(2)
  })

  it('leaves outreach and amber on the current visit', () => {
    const migration = read(MIGRATION)

    // needs_outreach decides when a client is chased; time an earlier round
    // consumed is not a reason to chase them about this one.
    const outreach = /\(x\.escalation_offset is not null and x\.days_in_stage >= x\.escalation_offset\) as needs_outreach/g
    expect(migration.match(outreach)).toHaveLength(2)
    const amber = /when x\.sla_days is not null and x\.days_in_stage >= \(x\.sla_days - 1\) then 'amber'/g
    expect(migration.match(amber)).toHaveLength(2)
  })

  it('matches matter totals on the engine key, not the raw stage', () => {
    const migration = read(MIGRATION)

    // v_matter_stage_totals is keyed by matters.stage while the board keys
    // matter rows by map_matter_stage_to_engine(). Half the vocabulary differs
    // — raw `revision` is engine `revisions` — so a direct match found nothing
    // for exactly the revision loop this was built for.
    expect(migration).toContain('public.map_matter_stage_to_engine(t.stage) as stage_key')
    expect(migration).toContain('group by t.matter_id, public.map_matter_stage_to_engine(t.stage)')
    expect(migration).toContain('sum(t.visits)::int as visits')
    // Lead rows key on the raw stage, which is what their arm already uses.
    expect(migration).toContain('on t.matter_id = m.id and t.stage = m.stage')
  })

  it('never reports a total below what the board already shows', () => {
    const migration = read(MIGRATION)

    const fallback = /coalesce\((mt|t)\.(cumulative_days|business_days), public\.business_days_elapsed\(coalesce\(m\.stage_entered_at, m\.created_at\)\)\)/g
    expect(migration.match(fallback)).toHaveLength(2)
  })

  it('lets a snooze suppress the cumulative breach too', () => {
    const migration = read(MIGRATION)

    const suppressed = /case when sn\.id is not null then false else b\.is_cumulative_overdue end as is_cumulative_overdue/g
    expect(migration.match(suppressed)).toHaveLength(2)
  })

  it('rebuilds the dependent union view and re-grants it', () => {
    const migration = read(MIGRATION)

    // v_pipeline_aging selects * from v_matter_aging, so it must be dropped
    // before the base view gains columns, and its UNION is positional.
    expect(migration.indexOf('drop view if exists public.v_pipeline_aging'))
      .toBeLessThan(migration.indexOf('create or replace view public.v_matter_aging'))
    expect(migration).toContain('grant select on public.v_pipeline_aging to authenticated, service_role')
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })
})

describe('aging reader', () => {
  it('reads the new columns and exposes the cumulative threshold for editing', () => {
    const source = read('lib/queries/pipelineAging.ts')

    expect(source).toContain('stage_visits, cumulative_days, cumulative_sla_days, is_cumulative_overdue')
    expect(source).toContain('cumulative_sla_days, stage_order')
    // The view supplies the totals now, correctly keyed; the old TypeScript
    // join is gone rather than left to disagree with it.
    expect(source).not.toContain('attachStageTotals')
    expect(source).not.toContain('stage_total_days')
  })

  it('ranks a cumulative-only breach by its overage, not its negative per-visit figure', () => {
    const source = read('lib/queries/pipelineAging.ts')

    // days_over_sla is negative for a fresh current visit, so a row red purely
    // on cumulative time would otherwise sort below every other red row.
    expect(source).toContain('function worstOverage')
    expect(source).toContain('row.cumulative_days - row.cumulative_sla_days')
    expect(source).toContain('Math.max(perVisit, cumulative)')
  })

  it('keeps the settings route and form able to edit the threshold', () => {
    expect(read('app/api/admin/settings/stage-sla/route.ts')).toContain('patch.cumulative_sla_days = cumulativeSlaDays')
    expect(read('app/admin/settings/PipelineSlaSettings.tsx')).toContain('cumulative_sla_days: cumulativeSlaDays')
    expect(read('app/admin/settings/PipelineSlaSettings.tsx')).toContain('<TableHead>Total days</TableHead>')
  })
})
