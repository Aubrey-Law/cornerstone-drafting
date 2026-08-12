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
    // The renumber must touch stage_order only. Re-seeding intake_sent with a
    // literal sla_days would silently revert a value edited in Settings.
    for (const key of ['intake_sent', 'intake_completed', 'engagement_sent']) {
      const renumber = new RegExp(
        `update public\\.stage_sla set stage_order = \\d+\\s+where stage_key = '${key}'`,
      )
      expect(source).toMatch(renumber)
    }
    expect(source).not.toMatch(/'intake_sent',\s*'DEFAULT',\s*'lead',\s*'client',\s*\d+/)
  })
})
