import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildPlanTaskDrafts, parseTemplateTasks } from '@/lib/slaTasks/schedule'
import { SLA_PHASES } from '@/lib/slaTasks/types'

/**
 * The legal-plan estate checklist is seeded in SQL as a copy of the private-pay
 * v3 list with its billing tasks changed and a benefits check added to the
 * lead. These tests read both so an edit to one that was meant for both shows
 * up as a failure, not drift. The LP list is read from its latest migration.
 */

function seededTasks(file: string): Record<string, unknown>[] {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8')
  const start = sql.indexOf("'[")
  const end = sql.indexOf("]'::jsonb", start)
  return JSON.parse(sql.slice(start + 1, end + 1)) as Record<string, unknown>[]
}

const LP_MIGRATION = '20270129090000_estate_planning_lp_member_benefits.sql'
const lp = seededTasks(LP_MIGRATION)
const ep = seededTasks('20260824000001_estate_planning_sla_v3.sql')

const BENEFITS = 'Request member ID and confirm benefits'

/** v3 rows the LP list renames. */
const LP_RENAMES: Record<string, string> = {
  'Generate final invoice if balance due': 'Invoice the client for any out-of-plan work',
  'Collect any balance due': 'Collect payment for any out-of-plan work',
  'File legal plan claim if applicable (MetLife / LegalEASE / ARAG)':
    'File legal plan claim (MetLife / LegalEASE / ARAG)',
}
/** v3 rows the LP list drops. */
const LP_REMOVED = new Set(['Send invoice / collect payment'])
/** Where the LP list adds a row: after this v3 task. */
const INSERTED_AFTER = 'Send post-discovery email (PMPS link + estate plan organizer)'

describe('the seeded Estate Planning (Legal Plan) template', () => {
  it('updates the template it means to', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', LP_MIGRATION), 'utf8')
    expect(sql).toContain("where template_name = 'estate_planning_lp_sla_v1'")
  })

  it('parses every seeded task, in the phases the app knows', () => {
    expect(parseTemplateTasks(lp)).toHaveLength(lp.length)
    for (const task of lp) {
      expect(SLA_PHASES, `unknown phase on "${task.name as string}"`).toContain(task.phase)
    }
  })

  it('follows the estate checklist row for row, apart from the LP changes', () => {
    const expected: string[] = []
    for (const task of ep) {
      const name = task.name as string
      if (!LP_REMOVED.has(name)) expected.push(LP_RENAMES[name] ?? name)
      if (name === INSERTED_AFTER) expected.push(BENEFITS)
    }
    expect(lp.map(task => task.name)).toEqual(expected)

    const lpByName = new Map(lp.map(task => [task.name, task]))
    for (const task of ep) {
      const name = task.name as string
      if (name in LP_RENAMES || LP_REMOVED.has(name)) continue
      expect(lpByName.get(name), `"${name}" differs from the estate checklist`).toEqual(task)
    }
  })

  it('confirms the member ID and benefits on the lead, before the planning session', () => {
    const benefits = lp.find(task => task.name === BENEFITS)
    expect(benefits).toMatchObject({
      phase: 'intake_sent',
      relative_to: 'discovery_call',
      pre_engagement: true,
      gate: 'fit_confirmed',
      assignee: 'attorney',
    })
  })

  it('sends no invoice at engagement', () => {
    const engaged = lp.filter(task => task.phase === 'intake').map(task => task.name as string)
    expect(engaged.some(name => /invoice|payment|coverage/i.test(name))).toBe(false)
  })

  it('always files the plan claim', () => {
    const claim = lp.find(task => /legal plan claim/i.test(task.name as string))
    expect(claim?.conditional).not.toBe(true)
  })

  it('leaves client billing conditional on out-of-plan work', () => {
    for (const task of lp) {
      if (/invoice|collect payment/i.test(task.name as string)) {
        expect(task.conditional, `"${task.name as string}" is not conditional`).toBe(true)
      }
    }
  })

  it('uses the current billing skill, not the retired one', () => {
    expect(lp.some(task => task.skill === 'qbo-invoice')).toBe(false)
  })

  it('puts the benefits check on the lead list, not the matter list', () => {
    const tasks = parseTemplateTasks(lp)
    const options = { matterId: 'm', templateId: 't', startDate: '2026-03-01' }
    const lead = buildPlanTaskDrafts(tasks, { ...options, scope: 'lead' }).map(task => task.name)
    const matter = buildPlanTaskDrafts(tasks, { ...options, scope: 'matter' }).map(task => task.name)
    expect(lead).toContain(BENEFITS)
    expect(matter).not.toContain(BENEFITS)
  })
})
