import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `escalation_offset` is the nudge — "reach out before this goes late" — and
 * is `sla_days - 1` on ten of the twelve stages carrying an SLA. The health
 * `case` painted it red, above the amber arm, so on every one of those stages
 * a row went red a business day before its SLA was breached (red while
 * `is_overdue` was false and `days_over_sla` read -1) and the amber arm below
 * could never be reached. The board carried zero amber rows across 79 leads
 * and matters on 2026-08-24.
 *
 * 20261019000000 moves the arm to amber in both entities. These pin the
 * ladder, because it is four `case` arms whose order is the whole behaviour.
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

/** The `case` that decides a colour, one per entity. */
function healthCases(sql: string): string[] {
  return sql.split('end as raw_health').slice(0, -1).map(part => part.slice(-1000))
}

const CASES = healthCases(SQL)

describe('the aging board has three colours', () => {
  it('decides a colour the same way for a lead and for a matter', () => {
    // Both arms live in this migration, and a rule that moved in one but not
    // the other would give the same delay two colours by entity.
    expect(CASES).toHaveLength(2)
  })

  it.each([0, 1])('paints the nudge amber rather than red (case %i)', index => {
    const health = CASES[index]!
    expect(health).toContain(
      "when x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset then 'amber'",
    )
  })

  it.each([0, 1])('keeps red for a broken promise and nothing else (case %i)', index => {
    const red = CASES[index]!.split('\n').filter(line => line.includes("then 'red'"))
    expect(red).toHaveLength(2)
    // Strictly past the budget, not on its last day — `days_over_sla` is the
    // number shown beside the colour and must not read 0 on a red row.
    expect(red[0]).toContain('x.days_in_stage > x.sla_days')
    expect(red[1]).toContain('x.cumulative_days > x.cumulative_sla_days')
  })

  it.each([0, 1])('tests every red arm before any amber one (case %i)', index => {
    const arms = CASES[index]!.split('\n').filter(line => line.includes("then 'red'") || line.includes("then 'amber'"))
    const lastRed = arms.map(line => line.includes("then 'red'")).lastIndexOf(true)
    const firstAmber = arms.findIndex(line => line.includes("then 'amber'"))
    expect(firstAmber).toBeGreaterThan(lastRed)
  })

  it('leaves the booleans beside the colour alone', () => {
    // Only which colour the marker paints changed. `needs_outreach` still
    // fires on the same threshold, and it is what the outreach queue reads.
    const flat = SQL.replace(/\s+/g, ' ')
    expect(flat).toContain('(x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset) as needs_outreach')
    expect(flat).toContain('(not x.is_scheduled and x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset) as needs_outreach')
  })
})
