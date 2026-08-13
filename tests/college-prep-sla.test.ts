import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'
import {
  buildMatterTaskInserts,
  isUntouchedTask,
  parseTemplateTasks,
  templateSwapVerdict,
} from '@/lib/slaTasks/schedule'
import { SLA_PHASES, type MatterTaskRow, type SlaTemplateTask } from '@/lib/slaTasks/types'
import { COLLEGE_PREP_SLA_V1, ESTATE_PLANNING_SLA_V3, slaTemplateForPracticeArea } from '@/lib/slaTasks/generate'

/**
 * The College Preparation Plan runs its own checklist. Two things have to hold
 * for that to mean anything: the practice area has to select it, and a lead that
 * was opened as an estate matter has to be able to move onto it when the
 * questionnaire says the engagement is actually a college plan.
 *
 * The template itself is seeded in SQL, so the last block reads the migration
 * and checks the tasks against the vocabulary the code will parse them with —
 * a phase or anchor the app does not know silently degrades at generation time
 * rather than failing.
 */

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260922000000_college_prep_sla_v1.sql',
)

function matterTask(overrides: Partial<MatterTaskRow> = {}): MatterTaskRow {
  return {
    id: 'task-1',
    matter_id: 'matter-1',
    template_id: 'estate-template',
    phase: 'new_lead',
    name: 'Task',
    sort_order: 0,
    assignee: 'attorney',
    skill: null,
    conditional: false,
    pauses_clock: false,
    start_date: '2026-03-01',
    due_date: null,
    nudge_date: null,
    nudge_tier: null,
    escalation_date: null,
    escalation_tier: null,
    due_offset_days: null,
    nudge_offset_days: null,
    escalation_offset_days: null,
    relative_to: null,
    pre_engagement: false,
    auto: false,
    gate: null,
    extends_target_days: null,
    recurring_interval_days: null,
    variant: null,
    triggers_day_zero: false,
    status: 'pending',
    completed_at: null,
    skipped_at: null,
    notes: null,
    paused_at: null,
    total_paused_days: 0,
    nudge_sent_at: null,
    escalation_sent_at: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

describe('picking a checklist from the practice area', () => {
  it('sends College Preparation Plan matters to their own template', () => {
    expect(slaTemplateForPracticeArea('CP')).toBe(COLLEGE_PREP_SLA_V1)
    expect(slaTemplateForPracticeArea('College Preparation Plan')).toBe(COLLEGE_PREP_SLA_V1)
  })

  it('leaves both estate planning areas on the estate template', () => {
    expect(slaTemplateForPracticeArea('EP')).toBe(ESTATE_PLANNING_SLA_V3)
    expect(slaTemplateForPracticeArea('EP-LP')).toBe(ESTATE_PLANNING_SLA_V3)
  })

  it('skips probate, which still has no template of its own', () => {
    expect(slaTemplateForPracticeArea('Probate')).toBeNull()
  })

  it('falls back to the estate template for a missing or unrecognized area', () => {
    expect(slaTemplateForPracticeArea(undefined)).toBe(ESTATE_PLANNING_SLA_V3)
    expect(slaTemplateForPracticeArea('Immigration')).toBe(ESTATE_PLANNING_SLA_V3)
  })

  it('resolves every practice area the app offers', () => {
    for (const option of PRACTICE_AREA_OPTIONS) {
      const template = slaTemplateForPracticeArea(option.value)
      expect(template === null || template.length > 0, `${option.value} has no verdict`).toBe(true)
    }
  })
})

describe('swapping a lead checklist for the one its matter needs', () => {
  const collegeTemplate = 'college-template'

  it('swaps when the whole checklist came from another template untouched', () => {
    const tasks = [matterTask({ id: 'a' }), matterTask({ id: 'b' })]
    expect(templateSwapVerdict(tasks, collegeTemplate)).toBe('swap')
  })

  it('leaves a checklist already on the right template alone', () => {
    const tasks = [matterTask({ template_id: collegeTemplate })]
    expect(templateSwapVerdict(tasks, collegeTemplate)).toBe('same_template')
  })

  it('refuses once any task is completed or skipped', () => {
    const completed = [
      matterTask({ id: 'a' }),
      matterTask({ id: 'b', status: 'completed', completed_at: '2026-03-04T00:00:00Z' }),
    ]
    expect(templateSwapVerdict(completed, collegeTemplate)).toBe('work_started')

    const skipped = [matterTask({ status: 'skipped', skipped_at: '2026-03-04T00:00:00Z' })]
    expect(templateSwapVerdict(skipped, collegeTemplate)).toBe('work_started')
  })

  it('refuses once a task carries a note or a pause', () => {
    expect(templateSwapVerdict([matterTask({ notes: 'called the parent' })], collegeTemplate)).toBe(
      'work_started',
    )
    expect(
      templateSwapVerdict([matterTask({ status: 'blocked', paused_at: '2026-03-04T00:00:00Z' })], collegeTemplate),
    ).toBe('work_started')
  })

  it('refuses when any task was added by hand rather than generated', () => {
    const tasks = [matterTask({ id: 'a' }), matterTask({ id: 'b', template_id: null })]
    expect(templateSwapVerdict(tasks, collegeTemplate)).toBe('work_started')
  })

  it('has nothing to say about a matter with no tasks', () => {
    expect(templateSwapVerdict([], collegeTemplate)).toBe('same_template')
  })

  it('treats whitespace-only notes as untouched', () => {
    expect(isUntouchedTask(matterTask({ notes: '   ' }))).toBe(true)
    expect(isUntouchedTask(matterTask({ notes: 'ready' }))).toBe(false)
  })
})

describe('the seeded College Preparation Plan template', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8')
  // The seeded array, between the quotes of the `'[...]'::jsonb` literal. Task
  // names carry no apostrophes, so the literal needs no unescaping.
  const json = sql.slice(sql.indexOf("'[") + 1, sql.indexOf("]'::jsonb") + 1)
  const raw = JSON.parse(json) as Record<string, unknown>[]
  const tasks: SlaTemplateTask[] = parseTemplateTasks(raw)

  it('parses every seeded task', () => {
    expect(raw.length).toBeGreaterThan(20)
    expect(tasks).toHaveLength(raw.length)
  })

  it('uses only phases the app knows', () => {
    // `parseTemplateTask` falls back to 'onboarding' for an unknown phase rather
    // than failing, so the raw values are what has to be checked.
    for (const task of raw) {
      expect(SLA_PHASES, `unknown phase on "${task.name as string}"`).toContain(task.phase)
    }
  })

  it('anchors the pre-engagement work to the intro call, never the PMPS', () => {
    for (const task of tasks) {
      expect(task.relative_to, `"${task.name}" hangs off the PMPS`).not.toBe('pmps')
      if (task.pre_engagement && task.due_offset_days !== null) {
        expect(task.relative_to, `"${task.name}" is undatable before Day 0`).toBe('discovery_call')
      }
    }
  })

  it('starts the firm clock on exactly one task', () => {
    const dayZero = tasks.filter(task => task.triggers_day_zero)
    expect(dayZero.map(task => task.name)).toEqual(['Client signs engagement agreement'])
  })

  it('asks the two questions the estate checklist never asks', () => {
    const names = tasks.map(task => task.name.toLowerCase())
    expect(names.some(name => name.includes('18'))).toBe(true)
    expect(names.some(name => name.includes('move-in'))).toBe(true)
    expect(names.some(name => name.includes('ferpa'))).toBe(true)
  })

  it('carries no trust, deed, or funding work', () => {
    for (const task of tasks) {
      expect(task.name.toLowerCase()).not.toMatch(/\btrust\b|\bdeed|\bfunding\b/)
      expect(task.phase, `"${task.name}" is in the funding phase`).not.toBe('funding')
      expect(task.skill).not.toBe('trust-funding')
      expect(task.skill).not.toBe('deed-drafting')
    }
  })

  it('lands the signing on the day the template promises', () => {
    const engagementDays = Number(sql.match(/^\s*(\d+), (\d+), (\d+),$/m)?.[3])
    const signing = tasks.find(task => task.name === 'Signing meeting held')
    expect(signing?.due_offset_days).toBe(engagementDays)
  })

  it('declares a target that is the two clocks added together', () => {
    const targets = sql.match(/^\s*(\d+), (\d+), (\d+),$/m)
    expect(targets, 'target_days line not found').toBeTruthy()
    const [total, pre, engagement] = (targets ?? []).slice(1).map(Number)
    expect(total).toBe(pre + engagement)
    // Every pre-engagement deadline has to fit inside the soft target, or the
    // engagement signature is due after the window it is measured against.
    for (const task of tasks) {
      if (task.pre_engagement && task.due_offset_days !== null) {
        expect(task.due_offset_days, `"${task.name}" overruns the soft clock`).toBeLessThanOrEqual(pre)
      }
    }
  })

  it('leaves every task undated on a lead that has not had its intro call', () => {
    const rows = buildMatterTaskInserts(tasks, {
      matterId: 'matter-1',
      templateId: 'college-template',
      startDate: '2026-03-01',
      anchors: {},
    })
    expect(rows.every(row => row.due_date === null)).toBe(true)
  })

  it('dates the pre-engagement work off the intro call and the rest off Day 0', () => {
    const rows = buildMatterTaskInserts(tasks, {
      matterId: 'matter-1',
      templateId: 'college-template',
      startDate: '2026-03-01',
      anchors: { discovery_call: '2026-03-02', engagement: '2026-03-12' },
    })

    const call = rows.find(row => row.name === 'Hold intro call')
    expect(call?.due_date).toBe('2026-03-02')

    const signature = rows.find(row => row.name === 'Client signs engagement agreement')
    expect(signature?.due_date).toBe('2026-03-12')

    const signing = rows.find(row => row.name === 'Signing meeting held')
    expect(signing?.due_date).toBe('2026-03-26')
  })
})
