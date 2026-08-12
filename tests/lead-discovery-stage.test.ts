import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260909000000_lead_discovery_stage.sql',
)

const sql = () => fs.readFileSync(MIGRATION, 'utf8')

/**
 * Parse the lead rows this migration seeds or renumbers, so the assertions read
 * as a table rather than a pile of substring checks.
 */
function leadStageOrders(source: string): Record<string, number> {
  const orders: Record<string, number> = {}
  const seeded = source.match(
    /values\s*\(\s*'discovery_call',\s*'DEFAULT',\s*'lead',\s*'attorney',\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/,
  )
  if (seeded) orders.discovery_call = Number(seeded[3])
  for (const m of source.matchAll(
    /update public\.stage_sla set stage_order = (\d+)\s+where stage_key = '([a-z_]+)'/g,
  )) {
    orders[m[2]] = Number(m[1])
  }
  return orders
}

describe('discovery_call lead stage', () => {
  it('seeds discovery_call as an attorney stage at 1 day', () => {
    const source = sql()
    expect(source).toMatch(
      /'discovery_call',\s*'DEFAULT',\s*'lead',\s*'attorney',\s*1,\s*1,\s*2/,
    )
  })

  it('orders the lead stages new_lead → discovery_call → intake → engagement', () => {
    const orders = leadStageOrders(sql())
    expect(orders).toMatchObject({
      discovery_call: 2,
      intake_sent: 3,
      intake_completed: 4,
      engagement_sent: 5,
    })
  })

  it('does not overwrite sla_days on the stages an admin may have tuned', () => {
    const source = sql()
    // The renumber must touch stage_order only. Re-seeding any of these stages
    // with a literal VALUES row would silently revert a value edited in
    // Settings. intake_sent and engagement_sent are owned by 'client';
    // intake_completed is owned by 'attorney' — match the owner loosely so
    // the check still catches a re-seed regardless of which owner is used.
    for (const key of ['intake_sent', 'intake_completed', 'engagement_sent']) {
      const renumber = new RegExp(
        `update public\\.stage_sla set stage_order = \\d+\\s+where stage_key = '${key}'`,
      )
      expect(source).toMatch(renumber)

      const reseed = new RegExp(`'${key}',\\s*'DEFAULT',\\s*'lead',\\s*'[a-z]+',\\s*\\d+`)
      expect(source).not.toMatch(reseed)
    }
  })

  it('stamps stage_entered_at only when the caller did not supply one', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.trg_matters_stage_entered_at()')
    // The INSERT arm must not reference OLD: it is unassigned in a BEFORE
    // INSERT trigger and referencing it raises.
    expect(source).toMatch(/if tg_op = 'INSERT' then\s+if new\.stage_entered_at is null then/)
    expect(source).toMatch(
      /elsif new\.stage is distinct from old\.stage then[\s\S]*?if new\.stage_entered_at is not distinct from old\.stage_entered_at then/,
    )
  })
})
