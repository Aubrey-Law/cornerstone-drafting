import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The lead half of the aging board was 27 red, 12 amber, 0 green — a board
 * with no green has stopped being a signal. Three mechanics produced that, and
 * 20261015000000 fixes two of them and surfaces the third. 20261018000000 then
 * fixes the fourth: the stage named after a meeting aged while the meeting was
 * still ahead. These pin the properties, because every one of them is a `case`
 * arm that reads fine and does the wrong thing.
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

/**
 * The two views live in different migrations now — the lead arm was redefined
 * without touching the matter one — so each is read from wherever it was last
 * defined rather than sliced out of a single file.
 */
const LEAD_SQL = newestSqlWith('create or replace view public.v_pipeline_aging')
const LEAD_ARM = LEAD_SQL.slice(LEAD_SQL.indexOf('create or replace view public.v_pipeline_aging'))

const MATTER_SQL = newestSqlWith('create or replace view public.v_matter_aging')
const MATTER_ARM = MATTER_SQL.slice(
  MATTER_SQL.indexOf('create or replace view public.v_matter_aging'),
  MATTER_SQL.indexOf('create or replace view public.v_pipeline_aging'),
)

const flat = LEAD_ARM.replace(/\s+/g, ' ')

describe('a booked call is scheduled, not aging', () => {
  it('marks a stage clock that has not started yet', () => {
    // The clock is now an anchored instant rather than the raw column, so the
    // test is that it is compared to now() at all.
    expect(flat).toContain('(a.clock_at > now()) as is_scheduled')
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
    expect(flat, 'is_overdue still fires for a scheduled lead')
      .toContain('( not x.is_scheduled and ( (x.sla_days is not null and x.days_in_stage > x.sla_days)')
    expect(flat, 'needs_outreach still fires for a scheduled lead')
      .toContain('(not x.is_scheduled and x.escalation_offset is not null')
    expect(flat, 'is_cumulative_overdue still fires for a scheduled lead')
      .toContain('(not x.is_scheduled and x.cumulative_sla_days is not null')
  })
})

describe('the meeting a stage waits on', () => {
  it('anchors the clock of the two stages that wait on one', () => {
    // `intake_sent` waits on the client's organizer and `engagement_sent` on
    // their signature. Neither has a date saying when the wait ends, so
    // neither may be anchored — a lead is not "scheduled" for a form.
    expect(flat).toContain(
      "case m.stage when 'discovery_call' then m.discovery_call_at when 'intake_completed' then m.pmps_at end as meeting_at",
    )
  })

  it('only ever moves the clock forward', () => {
    // `greatest`, not the meeting outright: a stage entered after its meeting
    // must not be rewound to it. greatest() ignores nulls, which is what lets
    // an unanchored stage keep its own clock.
    expect(flat).toContain('greatest(')
    expect(flat).not.toContain('least(')
  })

  it('measures from the meeting once it has happened, not from stage entry', () => {
    // Green while the session is ahead is half a fix. If the clock still ran
    // from stage entry underneath, the row would go from green to a fortnight
    // late the morning after the session.
    expect(flat).toContain('public.business_days_elapsed(a.clock_at) as days_in_stage')
  })

  it('displaces the history total with it', () => {
    // The cumulative rule reads the whole time in the stage, so leaving it on
    // stage entry turns the row red the morning after the meeting through the
    // other door.
    expect(flat).toContain(
      'case when a.stage_suspect or a.clock_from_meeting then public.business_days_elapsed(a.clock_at)',
    )
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
    expect(flat).toContain("r.stage_entered_at < r.created_at - interval '1 year') as stage_suspect")
    expect(flat).toContain('when d.stage_entered_at is null or d.stage_suspect then d.created_at')
  })

  it('ignores a meeting a year out rather than parking the lead for ever', () => {
    // The mirror of the 1969 case, and the one the anchor introduces: a
    // typo'd future year would read `is_scheduled` until it arrived, taking
    // the lead off the board entirely rather than colouring it wrongly.
    expect(flat).toContain("or r.meeting_at > now() + interval '1 year')) as meeting_suspect")
    expect(flat).toContain('case when d.meeting_suspect then null else d.meeting_at end')
  })

  it('guards the cumulative total too, not just the current visit', () => {
    // The same 1969 date reached the row twice: once as the stage clock, once
    // through the history row it wrote, where it totalled 14,860 days and
    // turned the row red by the cumulative rule instead.
    const cumulative = LEAD_ARM.slice(LEAD_ARM.indexOf('as cumulative_days') - 700, LEAD_ARM.indexOf('as cumulative_days'))
    expect(cumulative).toContain('a.stage_suspect')
  })

  it('surfaces the suspicion rather than swallowing it', () => {
    // A silently corrected date never gets fixed at source.
    expect(flat).toContain('(a.stage_suspect or a.meeting_suspect) as stage_clock_suspect')
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
    // can arise there; the guard would be noise at best. It has no meeting
    // columns to anchor either.
    expect(MATTER_ARM).not.toContain("interval '1 year'")
    expect(MATTER_ARM).not.toContain('x.is_scheduled')
    expect(MATTER_ARM).not.toContain('pmps_at')
  })
})
