import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The lead half of the aging board was 27 red, 12 amber, 0 green — a board
 * with no green has stopped being a signal. Three mechanics produced that, and
 * 20261015000000 fixes two of them and surfaces the third. These pin the
 * properties, because every one of them is a `case` arm that reads fine and
 * does the wrong thing.
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

function newestSqlWith(needle: string): string {
  const files = fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort().reverse()
  for (const name of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    if (sql.includes(needle)) return sql
  }
  throw new Error(`no migration contains ${needle}`)
}

const SQL = newestSqlWith('create or replace view public.v_pipeline_aging')

/** The lead arm, which is everything after the matter view it unions with. */
const LEAD_ARM = SQL.slice(SQL.indexOf('create or replace view public.v_pipeline_aging'))
const MATTER_ARM = SQL.slice(
  SQL.indexOf('create or replace view public.v_matter_aging'),
  SQL.indexOf('create or replace view public.v_pipeline_aging'),
)

describe('a booked call is scheduled, not aging', () => {
  it('marks a stage clock that has not started yet', () => {
    expect(LEAD_ARM).toContain("(m.stage_entered_at is not null and m.stage_entered_at > now()) as is_scheduled")
  })

  it('reads green while it is scheduled, before any other rule', () => {
    const health = LEAD_ARM.slice(LEAD_ARM.indexOf('end as raw_health') - 900, LEAD_ARM.indexOf('end as raw_health'))
    const scheduled = health.indexOf('when x.is_scheduled then')
    const overdue = health.indexOf('x.days_in_stage > x.sla_days')
    expect(scheduled).toBeGreaterThan(-1)
    // Order matters: a scheduled row must not fall through to a red rule.
    expect(scheduled).toBeLessThan(overdue)
  })

  it('owes nothing while it is scheduled', () => {
    // Whitespace-normalised so the assertion survives reformatting but still
    // reads one expression at a time — a looser window let a mutation through.
    const flat = LEAD_ARM.replace(/\s+/g, ' ')
    expect(flat, 'is_overdue still fires for a scheduled lead')
      .toContain('( not x.is_scheduled and ( (x.sla_days is not null and x.days_in_stage > x.sla_days)')
    expect(flat, 'needs_outreach still fires for a scheduled lead')
      .toContain('(not x.is_scheduled and x.escalation_offset is not null')
    expect(flat, 'is_cumulative_overdue still fires for a scheduled lead')
      .toContain('(not x.is_scheduled and x.cumulative_sla_days is not null')
  })
})

describe('amber means approaching the limit', () => {
  it('cannot fire on arrival for a one-day SLA', () => {
    // `days >= sla_days - 1` is `days >= 0` when the SLA is one day, which
    // every row satisfies the moment it enters the stage.
    expect(LEAD_ARM).toContain('x.sla_days > 1 and x.days_in_stage >= (x.sla_days - 1)')
  })
})

describe('an impossible date cannot run a clock', () => {
  it('measures from creation when the milestone predates the record', () => {
    expect(LEAD_ARM).toContain("m.stage_entered_at < m.created_at - interval '1 year'")
    expect(LEAD_ARM).toContain('as stage_clock_suspect')
  })

  it('guards the cumulative total too, not just the current visit', () => {
    // The same 1969 date reached the row twice: once as the stage clock, once
    // through the history row it wrote, where it totalled 14,860 days and
    // turned the row red by the cumulative rule instead.
    const cumulative = LEAD_ARM.slice(LEAD_ARM.indexOf('as cumulative_days') - 700, LEAD_ARM.indexOf('as cumulative_days'))
    expect(cumulative).toContain("interval '1 year'")
  })

  it('surfaces the suspicion rather than swallowing it', () => {
    // A silently corrected date never gets fixed at source.
    expect(LEAD_ARM).toContain('b.stage_clock_suspect')
  })
})

describe('matters do not move', () => {
  it('gains the two columns as constants, because the union demands them', () => {
    expect(MATTER_ARM).toContain('false as is_scheduled')
    expect(MATTER_ARM).toContain('false as stage_clock_suspect')
  })

  it('changes nothing else about a matter row', () => {
    // A matter's stage_entered_at is stamped now() by trigger, so neither case
    // can arise there; the guard would be noise at best.
    expect(MATTER_ARM).not.toContain("interval '1 year'")
    expect(MATTER_ARM).not.toContain('x.is_scheduled')
  })
})
