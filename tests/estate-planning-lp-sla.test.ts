import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseTemplateTasks } from '@/lib/slaTasks/schedule'
import { SLA_PHASES } from '@/lib/slaTasks/types'

/**
 * The legal-plan estate checklist is seeded in SQL as a copy of the private-pay
 * v3 list with four billing tasks changed. These tests read both migrations so
 * an edit to one that was meant for both shows up as a failure, not drift.
 */

function seededTasks(file: string, templateName: string): Record<string, unknown>[] {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8')
  const start = sql.indexOf("'[", sql.indexOf(`'${templateName}'`))
  const end = sql.indexOf("]'::jsonb", start)
  return JSON.parse(sql.slice(start + 1, end + 1)) as Record<string, unknown>[]
}

const lp = seededTasks('20270102090700_estate_planning_lp_sla_v1.sql', 'estate_planning_lp_sla_v1')
const ep = seededTasks('20260824000001_estate_planning_sla_v3.sql', 'estate_planning_sla_v3')

const LP_CHANGES: Record<string, string> = {
  'Send invoice / collect payment':
    'Confirm legal plan coverage and obtain the case / authorization number',
  'Generate final invoice if balance due': 'Invoice the client for any out-of-plan work',
  'Collect any balance due': 'Collect payment for any out-of-plan work',
  'File legal plan claim if applicable (MetLife / LegalEASE / ARAG)':
    'File legal plan claim (MetLife / LegalEASE / ARAG)',
}

describe('the seeded Estate Planning (Legal Plan) template', () => {
  it('parses every seeded task, in the phases the app knows', () => {
    expect(parseTemplateTasks(lp)).toHaveLength(lp.length)
    for (const task of lp) {
      expect(SLA_PHASES, `unknown phase on "${task.name as string}"`).toContain(task.phase)
    }
  })

  it('follows the estate checklist row for row, apart from the billing tasks', () => {
    expect(lp.map(task => task.name)).toEqual(
      ep.map(task => LP_CHANGES[task.name as string] ?? task.name),
    )
    const lpByName = new Map(lp.map(task => [task.name, task]))
    for (const task of ep) {
      const name = task.name as string
      if (name in LP_CHANGES) continue
      expect(lpByName.get(name), `"${name}" differs from the estate checklist`).toEqual(task)
    }
  })

  it('confirms coverage at engagement instead of invoicing', () => {
    const engaged = lp.filter(task => task.phase === 'intake').map(task => task.name as string)
    expect(engaged.some(name => /coverage/i.test(name))).toBe(true)
    expect(engaged.some(name => /invoice/i.test(name))).toBe(false)
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
})
