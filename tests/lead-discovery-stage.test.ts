import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260910000000_lead_discovery_stage.sql',
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

  it('advances a lead to discovery_call and pins the clock to the call date', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.stamp_lead_discovery_stage()')
    expect(source).toContain("new.stage := 'discovery_call'")
    expect(source).toContain('new.stage_entered_at := new.discovery_call_at')
  })

  it('guards the trigger to leads that have not moved past discovery', () => {
    const source = sql()
    expect(source).toContain("if new.relationship_status <> 'lead' then")
    expect(source).toContain("not in ('new_lead', 'discovery_call')")
  })

  it('reverts to new_lead when the date is cleared', () => {
    const source = sql()
    expect(source).toMatch(/else\s+new\.stage := 'new_lead';\s+new\.stage_entered_at := coalesce\(new\.created_at, now\(\)\)/)
  })

  it('fires on discovery_call_at only, so the stage stamper stays out of it', () => {
    const source = sql()
    expect(source).toContain('before update of discovery_call_at on public.matters')
    expect(source).toContain(
      'revoke execute on function public.stamp_lead_discovery_stage() from public, anon, authenticated',
    )
  })

  it('slots discovery between intake_sent and new_lead in the cascade', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.ensure_lead_matter()')
    expect(source).toMatch(
      /when new\.intake_sent_at is not null then 'intake_sent'\s+when v_discovery_call_at is not null then 'discovery_call'\s+else 'new_lead'/,
    )
  })

  it('reads discovery_call_at off the matter, since the trigger is on client_intake', () => {
    const source = sql()
    expect(source).toContain('v_discovery_call_at timestamptz')
    expect(source).toContain('select m.id, m.discovery_call_at')
    expect(source).toMatch(
      /v_stage_entered_at := coalesce\([^)]*v_discovery_call_at, new\.created_at, now\(\)\)/,
    )
  })

  it('backfills leads stuck in new_lead with a call date already recorded', () => {
    const source = sql()
    expect(source).toMatch(
      /update public\.matters\s+set stage = 'discovery_call',\s+stage_entered_at = discovery_call_at\s+where relationship_status = 'lead'\s+and stage = 'new_lead'\s+and discovery_call_at is not null/,
    )
  })

  it('backfills after the stage stamper is hardened, or the pin is lost', () => {
    const source = sql()
    const hardened = source.indexOf('create or replace function public.trg_matters_stage_entered_at()')
    const backfill = source.indexOf("set stage = 'discovery_call',")
    expect(hardened).toBeGreaterThan(-1)
    expect(backfill).toBeGreaterThan(hardened)
  })

  it('reloads the API schema cache', () => {
    expect(sql()).toContain("notify pgrst, 'reload schema'")
  })
})
