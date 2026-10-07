import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addMonths,
  computeDeadlines,
  deadlineBatchTag,
  dueDateFor,
  parseRulePatch,
  patchChangesTiming,
  planDeadlineTasks,
  planTargetWrites,
  rollPastWeekend,
  ruleFromRow,
  ruleSummary,
  type DeadlineRule,
  type ProbateFacts,
} from '@/lib/probateDeadlines/model'
import { TASK_SOURCES, TASK_SOURCE_LABEL, TASK_SOURCE_PILL } from '@/lib/tasks/types'
import { SETTINGS_NAV, resolveSettingsTab } from '@/app/admin/settings/settingsNav'

/**
 * Probate deadlines are dated from facts on the record by rules the attorney
 * confirms. These pin the arithmetic, the confirm gate, and that a deadline
 * task and a matter date follow a corrected anchor without overwriting what
 * the attorney typed or finished.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const MATTER = '00000000-0000-4000-8000-000000000001'

function rule(overrides: Partial<DeadlineRule> = {}): DeadlineRule {
  return {
    key: 'creditor_claims_period',
    title: 'Creditor claims period ends',
    description: null,
    anchor: 'date_of_death',
    offsetMonths: 12,
    offsetDays: 0,
    appliesWhen: 'always',
    rollWeekend: false,
    targetField: 'pb_claims_period_end_date',
    citation: 'M.G.L. c. 190B, section 3-803(a)',
    active: true,
    confirmedAt: '2026-10-06T12:00:00Z',
    confirmedBy: 'u1',
    sortOrder: 10,
    ...overrides,
  }
}

function facts(overrides: Partial<ProbateFacts> = {}): ProbateFacts {
  return {
    isProbate: true,
    anchors: { date_of_death: '2026-03-04', appointment_date: '2026-05-15' },
    federalEstateTaxRequired: false,
    stateEstateTaxRequired: true,
    ...overrides,
  }
}

describe('date arithmetic', () => {
  it('adds months and clamps to the month end', () => {
    expect(addMonths('2026-03-04', 12)).toBe('2027-03-04')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-05-31', 9)).toBe('2025-02-28')
  })

  it('moves a weekend to Monday only when the rule says so', () => {
    expect(rollPastWeekend('2026-10-10')).toBe('2026-10-12') // Saturday
    expect(rollPastWeekend('2026-10-11')).toBe('2026-10-12') // Sunday
    expect(rollPastWeekend('2026-10-12')).toBe('2026-10-12')
    // 2026-01-10 + 9 months = 2026-10-10, a Saturday.
    expect(dueDateFor({ offsetMonths: 9, offsetDays: 0, rollWeekend: true }, '2026-01-10')).toBe('2026-10-12')
    expect(dueDateFor({ offsetMonths: 9, offsetDays: 0, rollWeekend: false }, '2026-01-10')).toBe('2026-10-10')
  })

  it('describes a rule in words', () => {
    expect(ruleSummary(rule())).toBe('12 months after the date of death')
    expect(ruleSummary(rule({ anchor: 'appointment_date', offsetMonths: 3 }))).toBe('3 months after the appointment of the personal representative')
  })
})

describe('computeDeadlines', () => {
  it('dates a confirmed rule from its anchor', () => {
    const { deadlines } = computeDeadlines([rule()], facts())
    expect(deadlines).toEqual([expect.objectContaining({ ruleKey: 'creditor_claims_period', dueDate: '2027-03-04', anchorDate: '2026-03-04' })])
    expect(deadlines[0].basis).toBe('12 months after the date of death (2026-03-04)')
  })

  it('computes nothing from a draft, an inactive rule, or a matter that is not probate', () => {
    expect(computeDeadlines([rule({ confirmedAt: null })], facts()).skipped).toEqual([{ ruleKey: 'creditor_claims_period', reason: 'not_confirmed' }])
    expect(computeDeadlines([rule({ active: false })], facts()).skipped[0].reason).toBe('inactive')
    expect(computeDeadlines([rule()], facts({ isProbate: false })).deadlines).toEqual([])
  })

  it('waits for the anchor date, and honours the tax-return conditions', () => {
    expect(computeDeadlines([rule()], facts({ anchors: {} })).skipped[0].reason).toBe('no_anchor')
    const federal = rule({ key: 'federal_706_due', appliesWhen: 'federal_estate_tax', offsetMonths: 9 })
    const state = rule({ key: 'm706_due', appliesWhen: 'state_estate_tax', offsetMonths: 9 })
    const { deadlines, skipped } = computeDeadlines([federal, state], facts())
    expect(deadlines.map(item => item.ruleKey)).toEqual(['m706_due'])
    expect(skipped).toEqual([{ ruleKey: 'federal_706_due', reason: 'not_applicable' }])
  })
})

describe('tasks and matter dates', () => {
  const deadline = computeDeadlines([rule()], facts()).deadlines[0]
  const tag = deadlineBatchTag(MATTER, 'creditor_claims_period')

  it('creates one task per rule, then leaves it alone', () => {
    expect(planDeadlineTasks(MATTER, [deadline], []).inserts).toHaveLength(1)
    const same = planDeadlineTasks(MATTER, [deadline], [{ id: 't1', batchTag: tag, status: 'open', dueDate: '2027-03-04' }])
    expect(same).toEqual({ inserts: [], updates: [], unchanged: 1 })
  })

  it('redates an open task when the anchor is corrected, never a finished one', () => {
    const open = planDeadlineTasks(MATTER, [deadline], [{ id: 't1', batchTag: tag, status: 'open', dueDate: '2027-02-01' }])
    expect(open.updates).toEqual([{ taskId: 't1', deadline }])
    const done = planDeadlineTasks(MATTER, [deadline], [{ id: 't1', batchTag: tag, status: 'done', dueDate: '2027-02-01' }])
    expect(done).toEqual({ inserts: [], updates: [], unchanged: 1 })
  })

  it('fills an empty matter date, follows its own earlier date, and never overwrites a typed one', () => {
    expect(planTargetWrites([deadline], { pb_claims_period_end_date: null }, new Map())).toEqual({ pb_claims_period_end_date: '2027-03-04' })
    expect(planTargetWrites([deadline], { pb_claims_period_end_date: '2027-02-01' }, new Map([['creditor_claims_period', '2027-02-01']])))
      .toEqual({ pb_claims_period_end_date: '2027-03-04' })
    expect(planTargetWrites([deadline], { pb_claims_period_end_date: '2027-06-30' }, new Map([['creditor_claims_period', '2027-02-01']]))).toEqual({})
    expect(planTargetWrites([deadline], { pb_claims_period_end_date: '2027-03-04' }, new Map())).toEqual({})
  })
})

describe('editing a rule', () => {
  it('validates a patch', () => {
    expect(parseRulePatch({ key: 'm706_due', offsetMonths: 9, confirm: true })).toEqual({ key: 'm706_due', offsetMonths: 9, confirm: true })
    expect(() => parseRulePatch({ key: 'Bad Key' })).toThrow(/key/)
    expect(() => parseRulePatch({ key: 'm706_due', offsetMonths: 1.5 })).toThrow(/offsetMonths/)
    expect(() => parseRulePatch({ key: 'm706_due', anchor: 'birthday' })).toThrow(/anchor/)
    expect(() => parseRulePatch({ key: 'm706_due', targetField: 'pb_decedent_name' })).toThrow(/date field/)
  })

  it('treats a change to when it falls as needing confirmation again', () => {
    expect(patchChangesTiming(rule(), { key: 'creditor_claims_period', offsetMonths: 12 })).toBe(false)
    expect(patchChangesTiming(rule(), { key: 'creditor_claims_period', offsetMonths: 6 })).toBe(true)
    expect(patchChangesTiming(rule(), { key: 'creditor_claims_period', citation: 'new text' })).toBe(false)
  })

  it('reads a database row', () => {
    expect(ruleFromRow({ key: 'k', title: 'T', anchor: 'appointment_date', offset_months: 3, offset_days: 0, applies_when: 'always', roll_weekend: false, target_field: 'pb_inventory_due_date', active: true, confirmed_at: null, sort_order: 20 }))
      .toMatchObject({ anchor: 'appointment_date', offsetMonths: 3, targetField: 'pb_inventory_due_date', confirmedAt: null })
  })
})

describe('wiring', () => {
  it('seeds every rule as a draft, with its authority', () => {
    const sql = read('supabase/migrations/20270123090000_probate_deadlines.sql')
    expect(sql).toContain('create table if not exists public.probate_deadline_rules')
    for (const key of ['creditor_claims_period', 'inventory_due', 'm706_due', 'federal_706_due']) expect(sql).toContain(`('${key}'`)
    expect(sql).not.toMatch(/insert into public\.probate_deadline_rules[\s\S]*confirmed_at[\s\S]*values/)
    expect(sql).toContain("'identity', 'deadline'))")
    expect(sql).toContain('add column if not exists pb_letters_issued_date date')
    expect(sql).toContain('add column if not exists pb_petition_filed_date date')
  })

  it('makes deadline a task source with a label and pill', () => {
    expect(TASK_SOURCES).toContain('deadline')
    expect(TASK_SOURCE_LABEL.deadline).toBe('Deadline')
    expect(TASK_SOURCE_PILL.deadline).toBeTruthy()
  })

  it('recomputes when a matter fact changes and when a rule changes', () => {
    const matterRoute = read('app/api/admin/matter-details/route.ts')
    expect(matterRoute).toContain('if (DEADLINE_INPUT_FIELDS.has(field))')
    expect(matterRoute).toContain("'pb_letters_issued_date', 'pb_petition_filed_date'")
    const settingsRoute = read('app/api/admin/settings/probate-deadlines/route.ts')
    expect(settingsRoute).toContain('requireAdministrator(req)')
    expect(settingsRoute).toContain('syncAllProbateDeadlines(admin)')
  })

  it('has a settings tab and generated types', () => {
    expect(SETTINGS_NAV.flatMap(group => group.items).some(item => item.kind === 'tab' && item.tab === 'probate-deadlines')).toBe(true)
    expect(resolveSettingsTab('probate-deadlines', false)).toBe('probate-deadlines')
    const types = read('packages/db-types/src/supabase.generated.ts')
    expect(types).toContain('      probate_deadline_rules: {')
    expect(types).toContain('pb_letters_issued_date: string | null')
  })
})
